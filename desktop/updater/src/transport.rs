use crate::{Result, manifest::https_url};
use std::{
    io::Write,
    ptr,
    time::{Duration, Instant},
};
use windows::{
    Win32::Networking::WinHttp::*,
    core::{HSTRING, PCWSTR, w},
};

pub trait Transport: Send + Sync + 'static {
    fn get(
        &self,
        url: &str,
        limit: u64,
        output: &mut dyn Write,
        progress: &mut dyn FnMut(u64),
    ) -> Result<()>;
}

pub struct WindowsHttp;
struct Handle(*mut std::ffi::c_void);
impl Handle {
    fn new(raw: *mut std::ffi::c_void) -> windows::core::Result<Self> {
        if raw.is_null() {
            Err(windows::core::Error::from_thread())
        } else {
            Ok(Self(raw))
        }
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            let _ = WinHttpCloseHandle(self.0);
        }
    }
}

impl Transport for WindowsHttp {
    fn get(
        &self,
        address: &str,
        limit: u64,
        output: &mut dyn Write,
        progress: &mut dyn FnMut(u64),
    ) -> Result<()> {
        let url = https_url(address)?;
        let mut resource = url.path().to_owned();
        if let Some(query) = url.query() {
            resource.push('?');
            resource.push_str(query);
        }
        let run = || -> windows::core::Result<()> {
            unsafe {
                let session = Handle::new(WinHttpOpen(
                    w!("Patina GPUI Updater/1"),
                    WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                    PCWSTR::null(),
                    PCWSTR::null(),
                    0,
                ))?;
                WinHttpSetTimeouts(session.0, 15000, 15000, 15000, 30000)?;
                let connection = Handle::new(WinHttpConnect(
                    session.0,
                    &HSTRING::from(url.host_str().unwrap()),
                    url.port_or_known_default().unwrap(),
                    0,
                ))?;
                let request = Handle::new(WinHttpOpenRequest(
                    connection.0,
                    w!("GET"),
                    &HSTRING::from(resource),
                    PCWSTR::null(),
                    PCWSTR::null(),
                    ptr::null(),
                    WINHTTP_FLAG_SECURE,
                ))?;
                WinHttpSetOption(
                    Some(request.0),
                    WINHTTP_OPTION_REDIRECT_POLICY,
                    Some(&WINHTTP_OPTION_REDIRECT_POLICY_DISALLOW_HTTPS_TO_HTTP.to_ne_bytes()),
                )?;
                WinHttpSendRequest(request.0, None, None, 0, 0, 0)?;
                WinHttpReceiveResponse(request.0, ptr::null_mut())?;
                let mut status = 0u32;
                let mut len = 4u32;
                WinHttpQueryHeaders(
                    request.0,
                    WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                    PCWSTR::null(),
                    Some((&mut status as *mut u32).cast()),
                    &mut len,
                    ptr::null_mut(),
                )?;
                if status != 200 {
                    return Err(windows::core::Error::new(
                        windows::core::HRESULT(0x80004005u32 as i32),
                        format!("Update server returned HTTP {status}"),
                    ));
                }
                let start = Instant::now();
                let mut received = 0;
                let mut bytes = [0u8; 65536];
                loop {
                    if start.elapsed() > Duration::from_secs(1800) {
                        return Err(windows::core::Error::from(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            "Update download deadline exceeded",
                        )));
                    }
                    let mut read = 0;
                    WinHttpReadData(
                        request.0,
                        bytes.as_mut_ptr().cast(),
                        bytes.len() as u32,
                        &mut read,
                    )?;
                    if read == 0 {
                        break;
                    }
                    received += u64::from(read);
                    if received > limit {
                        return Err(windows::core::Error::from(std::io::Error::other(
                            "Update response exceeded size limit",
                        )));
                    }
                    output.write_all(&bytes[..read as usize])?;
                    progress(received);
                }
                Ok(())
            }
        };
        run().map_err(|e| e.to_string())
    }
}
