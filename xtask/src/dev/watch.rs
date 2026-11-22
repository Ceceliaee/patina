use std::{io, os::windows::ffi::OsStrExt, path::Path};
use windows_sys::Win32::{
    Foundation::{HANDLE, INVALID_HANDLE_VALUE, WAIT_FAILED, WAIT_TIMEOUT},
    Storage::FileSystem::{
        FILE_NOTIFY_CHANGE_DIR_NAME, FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_CHANGE_LAST_WRITE,
        FindCloseChangeNotification, FindFirstChangeNotificationW, FindNextChangeNotification,
    },
    System::Threading::WaitForMultipleObjects,
};

pub struct SourceWatcher(Vec<HANDLE>);

pub(super) const WATCHED_DIRECTORIES: &[(&str, bool)] = &[
    ("", false),
    (".cargo", true),
    ("apps", true),
    ("crates", true),
    ("locales", true),
    ("packaging/windows", true),
    ("plugins/bundled", false),
    ("plugins/bundled/focus", true),
    ("plugins/bundled/reminders", true),
    ("vendor", true),
];

impl SourceWatcher {
    pub fn new(root: &Path) -> io::Result<Self> {
        let mut watcher = Self(Vec::new());
        for &(path, recursive) in WATCHED_DIRECTORIES {
            let name: Vec<_> = root
                .join(path)
                .as_os_str()
                .encode_wide()
                .chain([0])
                .collect();
            let handle = unsafe {
                FindFirstChangeNotificationW(
                    name.as_ptr(),
                    recursive.into(),
                    FILE_NOTIFY_CHANGE_FILE_NAME
                        | FILE_NOTIFY_CHANGE_DIR_NAME
                        | FILE_NOTIFY_CHANGE_LAST_WRITE,
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                return Err(io::Error::other(format!(
                    "watch {path}: {}",
                    io::Error::last_os_error()
                )));
            }
            watcher.0.push(handle);
        }
        Ok(watcher)
    }

    pub fn wait_for_change(&self, timeout_ms: u32) -> io::Result<bool> {
        match unsafe { WaitForMultipleObjects(self.0.len() as u32, self.0.as_ptr(), 0, timeout_ms) }
        {
            WAIT_TIMEOUT => Ok(false),
            WAIT_FAILED => Err(io::Error::last_os_error()),
            index => {
                if unsafe { FindNextChangeNotification(self.0[index as usize]) } == 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(true)
            }
        }
    }
}

impl Drop for SourceWatcher {
    fn drop(&mut self) {
        for handle in self.0.drain(..) {
            unsafe { FindCloseChangeNotification(handle) };
        }
    }
}
