use super::*;
use std::io::{BufRead, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use windows::Win32::Media::Audio::{
    IAudioClient, IAudioRenderClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    DEVICE_STATE_ACTIVE,
};

struct SilentSession(IAudioClient);
impl Drop for SilentSession {
    fn drop(&mut self) {
        let _ = unsafe { self.0.Stop() };
    }
}

pub(super) fn verify_lifecycle() {
    let mut probe = AudioSessionProbe::new().unwrap();
    probe.query(super::super::now_ms()).unwrap();
    let initial_id = probe.endpoint.as_ref().unwrap().id.clone();
    let initial_manager = probe.endpoint.as_ref().unwrap().manager.as_raw();
    let received = probe.endpoint.as_ref().unwrap().received.clone();
    let before_notifications = received.load(Ordering::Relaxed);
    for _ in 0..32 {
        probe.query(super::super::now_ms()).unwrap();
        assert_eq!(
            probe.endpoint.as_ref().unwrap().manager.as_raw(),
            initial_manager
        );
    }

    let (mut client, lines) = SilentClient::start();
    let identity = wait_line(&lines, "AUDIO_CLIENT_READY ");
    let client_pid = client.0.id();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let snapshot = probe.query(super::super::now_ms()).unwrap();
        if received.load(Ordering::Relaxed) > before_notifications
            && probe
                .endpoint
                .as_ref()
                .unwrap()
                .sessions
                .contains_key(&identity)
            && snapshot.sessions.iter().any(|s| s.process_id == client_pid)
        {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "new audio session was not observed"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(
        probe.endpoint.as_ref().unwrap().manager.as_raw(),
        initial_manager
    );
    client.command("stop");
    wait_line(&lines, "AUDIO_CLIENT_STOPPED");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let snapshot = probe.query(super::super::now_ms()).unwrap();
        if !snapshot.sessions.iter().any(|s| s.process_id == client_pid) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "stopped audio session remained active"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    println!(
        "AUDIO_LIFECYCLE manager reused; real new silent session notification and stop observed"
    );

    // Exercise the callback's actual bounded channel and the caller's invalidation,
    // using owned references to this fixture's session rather than synthetic PIDs.
    let notification = probe.endpoint.as_ref().unwrap().notification.clone();
    let session = probe.endpoint.as_ref().unwrap().sessions[&identity]
        .cast::<IAudioSessionControl>()
        .unwrap();
    for _ in 0..=SESSION_CAPACITY {
        unsafe { notification.OnSessionCreated(&session) }.unwrap();
    }
    assert!(probe.query(super::super::now_ms()).is_err());
    assert!(probe.endpoint.is_none());
    drop(notification);
    probe.query(super::super::now_ms()).unwrap();
    assert_eq!(probe.endpoint.as_ref().unwrap().id, initial_id);
    assert!(probe
        .query_device(
            super::super::now_ms(),
            Err("test endpoint unavailable".into())
        )
        .is_err());
    assert!(probe.endpoint.is_none());
    probe.query(super::super::now_ms()).unwrap();
    println!(
        "AUDIO_LIFECYCLE overflow and unavailable endpoint cleared inventory; next request rebuilt"
    );

    unsafe {
        probe
            .device_notification
            .OnDeviceStateChanged(PCWSTR::null(), DEVICE_STATE_ACTIVE)
    }
    .unwrap();
    assert!(probe.device_changed.load(Ordering::Acquire));
    probe.query(super::super::now_ms()).unwrap();
    assert!(!probe.device_changed.load(Ordering::Acquire));
    println!("AUDIO_LIFECYCLE device notification invalidated retained manager");

    // Select another already-active endpoint only inside this probe. The Windows
    // default device and the user's playback applications are never changed.
    let devices = unsafe {
        probe
            .devices
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
    }
    .unwrap();
    let mut changed = false;
    for index in 0..unsafe { devices.GetCount() }.unwrap() {
        let candidate = unsafe { devices.Item(index) }.unwrap();
        let id = task_string(unsafe { candidate.GetId() }.unwrap()).unwrap();
        if id != initial_id {
            probe
                .query_device(super::super::now_ms(), Ok(candidate))
                .unwrap();
            assert_eq!(probe.endpoint.as_ref().unwrap().id, id);
            probe.query(super::super::now_ms()).unwrap();
            assert_eq!(probe.endpoint.as_ref().unwrap().id, initial_id);
            changed = true;
            break;
        }
    }
    println!("AUDIO_LIFECYCLE alternate active endpoint exercised={changed}");
    drop(session);
    client.command("exit");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while client.0.try_wait().unwrap().is_none() {
        assert!(
            std::time::Instant::now() < deadline,
            "silent client did not exit"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(client.0.wait().unwrap().success());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        probe.query(super::super::now_ms()).unwrap();
        if !probe
            .endpoint
            .as_ref()
            .unwrap()
            .sessions
            .contains_key(&identity)
        {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "expired session was retained"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    println!("AUDIO_LIFECYCLE disconnected session expired and was released");
}

struct SilentClient(Child);

impl SilentClient {
    fn start() -> (Self, Receiver<String>) {
        let child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "platform::windows::audio::resource_tests::audio_resource_boundaries",
                "--ignored",
                "--nocapture",
            ])
            .env("PATINA_AUDIO_RESOURCE_CASE", "silent-client")
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let mut owner = Self(child);
        let output = owner.0.stdout.take().unwrap();
        let (sender, receiver) = mpsc::sync_channel(16);
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(output)
                .lines()
                .map_while(Result::ok)
            {
                let _ = sender.try_send(line);
            }
        });
        (owner, receiver)
    }

    fn command(&mut self, command: &str) {
        writeln!(self.0.stdin.as_mut().unwrap(), "{command}").unwrap();
        self.0.stdin.as_mut().unwrap().flush().unwrap();
    }
}

impl Drop for SilentClient {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

fn wait_line(lines: &Receiver<String>, prefix: &str) -> String {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let line = lines
            .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
            .expect("silent client handshake timed out");
        if let Some(value) = line.strip_prefix(prefix) {
            return value.to_owned();
        }
    }
}

pub(super) fn run_silent_client() {
    let _apartment = ComGuard::initialize().unwrap();
    let devices: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.unwrap();
    let device = unsafe { devices.GetDefaultAudioEndpoint(eRender, eMultimedia) }.unwrap();
    let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }.unwrap();
    let client = SilentSession(client);
    let format = unsafe { client.0.GetMixFormat() }.unwrap();
    let guid = windows::core::GUID::from_u128(uuid::Uuid::new_v4().as_u128());
    let initialized = unsafe {
        client.0.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            0,
            1_000_000,
            0,
            format,
            Some(&guid),
        )
    };
    unsafe { CoTaskMemFree(Some(format.cast())) };
    initialized.unwrap();
    let session: IAudioSessionControl2 = unsafe { client.0.GetService::<IAudioSessionControl>() }
        .unwrap()
        .cast()
        .unwrap();
    let identity = task_string(unsafe { session.GetSessionInstanceIdentifier() }.unwrap()).unwrap();
    let render: IAudioRenderClient = unsafe { client.0.GetService() }.unwrap();
    let frames = unsafe { client.0.GetBufferSize() }.unwrap();
    unsafe {
        render.GetBuffer(frames).unwrap();
        render
            .ReleaseBuffer(frames, AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)
            .unwrap();
        client.0.Start().unwrap();
    }
    println!("AUDIO_CLIENT_READY {identity}");
    std::io::stdout().flush().unwrap();
    let (sender, receiver) = mpsc::sync_channel(4);
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if sender.try_send(line).is_err() {
                break;
            }
        }
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    while let Ok(command) =
        receiver.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
    {
        match command.as_str() {
            "stop" => {
                unsafe { client.0.Stop() }.unwrap();
                println!("AUDIO_CLIENT_STOPPED");
                std::io::stdout().flush().unwrap();
            }
            "exit" => break,
            _ => panic!("unexpected silent client command"),
        }
    }
}
