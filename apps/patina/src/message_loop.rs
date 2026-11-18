use std::{
    future::Future,
    io,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    sync::Arc,
    task::{Context, Poll, Wake, Waker},
};
use windows::Win32::{
    Foundation::{HANDLE, WAIT_FAILED},
    System::Threading::{CreateEventW, INFINITE, SetEvent},
    UI::WindowsAndMessaging::{
        DispatchMessageW, MSG, MWMO_INPUTAVAILABLE, MsgWaitForMultipleObjectsEx, PM_REMOVE,
        PeekMessageW, QS_ALLINPUT, TranslateMessage,
    },
};

struct MessageWake(OwnedHandle);

impl Wake for MessageWake {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        // The waker owns the event until every pending producer drops its reference.
        unsafe {
            let _ = SetEvent(HANDLE(self.0.as_raw_handle()));
        }
    }
}

pub(super) fn run<T>(future: impl Future<Output = T>) -> io::Result<T> {
    let handle = unsafe { CreateEventW(None, false, false, None)? };
    let event = Arc::new(MessageWake(unsafe {
        OwnedHandle::from_raw_handle(handle.0)
    }));
    let waker = Waker::from(event);
    let mut context = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        if let Poll::Ready(output) = future.as_mut().poll(&mut context) {
            return Ok(output);
        }
        let result = unsafe {
            MsgWaitForMultipleObjectsEx(Some(&[handle]), INFINITE, QS_ALLINPUT, MWMO_INPUTAVAILABLE)
        };
        if result == WAIT_FAILED {
            return Err(io::Error::last_os_error());
        }
        let mut message = MSG::default();
        for _ in 0..64 {
            if !unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
                break;
            }
            unsafe {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }
}
