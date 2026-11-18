use super::{snapshot_from_sessions, ComGuard};
use crate::domain::tracking::AudioSnapshot;
use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, SyncSender, TrySendError},
    Arc,
};
use windows::core::{implement, Interface, Ref, PCWSTR, PWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, AudioSessionStateExpired, EDataFlow, ERole, IAudioSessionControl,
    IAudioSessionControl2, IAudioSessionManager2, IAudioSessionNotification,
    IAudioSessionNotification_Impl, IMMDevice, IMMDeviceEnumerator, IMMNotificationClient,
    IMMNotificationClient_Impl, MMDeviceEnumerator, DEVICE_STATE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
#[cfg(test)]
mod tests;

// Overflow is unavailable evidence, never a silently truncated session list.
const SESSION_CAPACITY: usize = 1_024;

pub(crate) struct AudioSessionProbe {
    endpoint: Option<EndpointSessions>,
    devices: IMMDeviceEnumerator,
    device_notification: IMMNotificationClient,
    device_changed: Arc<AtomicBool>,
    // Interfaces and notification registrations must be released before COM.
    _apartment: ComGuard,
}

impl AudioSessionProbe {
    pub(crate) fn new() -> Result<Self, String> {
        let apartment = ComGuard::initialize()?;
        let devices: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|error| format!("creating audio device enumerator failed: {error}"))?;
        let device_changed = Arc::new(AtomicBool::new(false));
        let device_notification: IMMNotificationClient =
            DeviceNotification(device_changed.clone()).into();
        unsafe { devices.RegisterEndpointNotificationCallback(&device_notification) }
            .map_err(|error| format!("registering audio device notifications failed: {error}"))?;
        Ok(Self {
            endpoint: None,
            devices,
            device_notification,
            device_changed,
            _apartment: apartment,
        })
    }

    pub(crate) fn query(&mut self, now_ms: i64) -> Result<AudioSnapshot, String> {
        let device = unsafe { self.devices.GetDefaultAudioEndpoint(eRender, eMultimedia) }
            .map_err(|error| format!("loading default audio endpoint failed: {error}"));
        self.query_device(now_ms, device)
    }

    fn query_device(
        &mut self,
        now_ms: i64,
        device: Result<IMMDevice, String>,
    ) -> Result<AudioSnapshot, String> {
        if self.device_changed.swap(false, Ordering::AcqRel) {
            self.endpoint = None;
        }
        let result = device.and_then(|device| self.query_current_endpoint(now_ms, &device));
        let result = if self.device_changed.load(Ordering::Acquire) {
            Err("audio device changed during query".into())
        } else {
            result
        };
        if result.is_err() {
            // A disconnected device, missed notification or failed session read
            // invalidates the complete inventory. The next request can rebuild.
            self.endpoint = None;
        }
        result
    }

    fn query_current_endpoint(
        &mut self,
        now_ms: i64,
        device: &IMMDevice,
    ) -> Result<AudioSnapshot, String> {
        let id = task_string(
            unsafe { device.GetId() }
                .map_err(|error| format!("reading audio endpoint identity failed: {error}"))?,
        )?;
        if self
            .endpoint
            .as_ref()
            .is_none_or(|current| current.id != id)
        {
            // Drop the old registration even if constructing the replacement fails.
            self.endpoint = None;
            self.endpoint = Some(EndpointSessions::new(id, device)?);
        }
        let current = self.endpoint.as_mut().ok_or("audio endpoint unavailable")?;
        current.refresh()?;
        #[cfg(test)]
        super::resource_tests::inventory(current.sessions.len() as i32);
        snapshot_from_sessions(now_ms, current.sessions.values().cloned())
    }
}

impl Drop for AudioSessionProbe {
    fn drop(&mut self) {
        let _ = unsafe {
            self.devices
                .UnregisterEndpointNotificationCallback(&self.device_notification)
        };
        self.endpoint = None;
    }
}

struct EndpointSessions {
    id: String,
    manager: IAudioSessionManager2,
    notification: IAudioSessionNotification,
    incoming: Receiver<IAudioSessionControl>,
    overflow: Arc<AtomicBool>,
    sessions: BTreeMap<String, IAudioSessionControl2>,
    #[cfg(test)]
    received: Arc<std::sync::atomic::AtomicUsize>,
}

impl EndpointSessions {
    fn new(id: String, device: &IMMDevice) -> Result<Self, String> {
        let manager = unsafe { device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) }
            .map_err(|error| format!("activating audio session manager failed: {error}"))?;
        let (sender, incoming) = mpsc::sync_channel(SESSION_CAPACITY);
        let overflow = Arc::new(AtomicBool::new(false));
        #[cfg(test)]
        let received = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let notification: IAudioSessionNotification = SessionNotification {
            sender,
            overflow: overflow.clone(),
            #[cfg(test)]
            received: received.clone(),
        }
        .into();
        unsafe { manager.RegisterSessionNotification(&notification) }
            .map_err(|error| format!("registering audio sessions failed: {error}"))?;
        let mut current = Self {
            id,
            manager,
            notification,
            incoming,
            overflow,
            sessions: BTreeMap::new(),
            #[cfg(test)]
            received,
        };
        // Register first, then GetCount enables notifications. Merge the initial
        // enumeration and queued notifications by the native instance identity.
        current.enumerate()?;
        current.refresh()?;
        Ok(current)
    }

    fn enumerate(&mut self) -> Result<(), String> {
        let initial = unsafe { self.manager.GetSessionEnumerator() }
            .map_err(|error| format!("loading audio sessions failed: {error}"))?;
        let count = unsafe { initial.GetCount() }
            .map_err(|error| format!("reading audio session count failed: {error}"))?;
        if !(0..=SESSION_CAPACITY as i32).contains(&count) {
            return Err("audio session inventory exceeds capacity".into());
        }
        for index in 0..count {
            let session = unsafe { initial.GetSession(index) }
                .map_err(|error| format!("reading audio session at {index} failed: {error}"))?;
            self.insert(session)?;
        }
        Ok(())
    }

    fn insert(&mut self, session: IAudioSessionControl) -> Result<(), String> {
        let session = session
            .cast::<IAudioSessionControl2>()
            .map_err(|error| format!("casting audio session failed: {error}"))?;
        if unsafe { session.GetState() }.map_err(|error| error.to_string())?
            == AudioSessionStateExpired
        {
            return Ok(());
        }
        let id = task_string(
            unsafe { session.GetSessionInstanceIdentifier() }
                .map_err(|error| format!("reading audio session identity failed: {error}"))?,
        )?;
        if !self.sessions.contains_key(&id) && self.sessions.len() >= SESSION_CAPACITY {
            return Err("audio session inventory exceeds capacity".into());
        }
        self.sessions.entry(id).or_insert(session);
        Ok(())
    }

    fn refresh(&mut self) -> Result<(), String> {
        if self.overflow.load(Ordering::Acquire) {
            return Err("audio session notifications exceeded capacity".into());
        }
        let mut expired = Vec::new();
        for (id, session) in &self.sessions {
            let state = unsafe { session.GetState() }
                .map_err(|error| format!("reading audio session state failed: {error}"))?;
            if state == AudioSessionStateExpired {
                expired.push(id.clone());
            }
        }
        for id in expired {
            self.sessions.remove(&id);
        }
        for _ in 0..SESSION_CAPACITY {
            match self.incoming.try_recv() {
                Ok(session) => self.insert(session)?,
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    return Err("audio session notifications disconnected".into());
                }
            }
        }
        if self.overflow.load(Ordering::Acquire) {
            return Err("audio session notifications exceeded capacity".into());
        }
        Ok(())
    }
}

#[implement(IMMNotificationClient)]
struct DeviceNotification(Arc<AtomicBool>);

impl IMMNotificationClient_Impl for DeviceNotification_Impl {
    fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> windows::core::Result<()> {
        self.0.store(true, Ordering::Release);
        Ok(())
    }

    fn OnDeviceAdded(&self, _: &PCWSTR) -> windows::core::Result<()> {
        self.0.store(true, Ordering::Release);
        Ok(())
    }

    fn OnDeviceRemoved(&self, _: &PCWSTR) -> windows::core::Result<()> {
        self.0.store(true, Ordering::Release);
        Ok(())
    }

    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        role: ERole,
        _: &PCWSTR,
    ) -> windows::core::Result<()> {
        if flow == eRender && role == eMultimedia {
            self.0.store(true, Ordering::Release);
        }
        Ok(())
    }

    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> windows::core::Result<()> {
        Ok(())
    }
}

impl Drop for EndpointSessions {
    fn drop(&mut self) {
        // The callback only owns its bounded sender, never this registration.
        // No callback lock is held while unregistering or releasing interfaces.
        let _ = unsafe {
            self.manager
                .UnregisterSessionNotification(&self.notification)
        };
    }
}

#[implement(IAudioSessionNotification)]
struct SessionNotification {
    sender: SyncSender<IAudioSessionControl>,
    overflow: Arc<AtomicBool>,
    #[cfg(test)]
    received: Arc<std::sync::atomic::AtomicUsize>,
}

impl IAudioSessionNotification_Impl for SessionNotification_Impl {
    fn OnSessionCreated(&self, session: Ref<IAudioSessionControl>) -> windows::core::Result<()> {
        #[cfg(test)]
        self.received.fetch_add(1, Ordering::Relaxed);
        if let Some(session) = session.as_ref() {
            match self.sender.try_send(session.clone()) {
                Ok(()) | Err(TrySendError::Disconnected(_)) => (),
                Err(TrySendError::Full(_)) => self.overflow.store(true, Ordering::Release),
            }
        } else {
            self.overflow.store(true, Ordering::Release);
        }
        Ok(())
    }
}

#[cfg(test)]
pub(super) fn verify_lifecycle() {
    tests::verify_lifecycle();
}

#[cfg(test)]
pub(super) fn run_silent_client() {
    tests::run_silent_client();
}

fn task_string(value: PWSTR) -> Result<String, String> {
    let result = unsafe { value.to_string() }
        .map_err(|error| format!("reading audio identity string failed: {error}"));
    unsafe { CoTaskMemFree(Some(value.0.cast())) };
    result
}
