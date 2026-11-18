use std::os::windows::io::{FromRawHandle, OwnedHandle};
use windows::Win32::System::JobObjects;

pub fn kill_on_close() -> Result<OwnedHandle, &'static str> {
    let handle =
        unsafe { JobObjects::CreateJobObjectW(None, None) }.map_err(|_| "Job creation failed")?;
    let job = unsafe { OwnedHandle::from_raw_handle(handle.0) };
    let mut limits = JobObjects::JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JobObjects::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    unsafe {
        JobObjects::SetInformationJobObject(
            handle,
            JobObjects::JobObjectExtendedLimitInformation,
            (&limits as *const JobObjects::JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&limits) as u32,
        )
    }
    .map_err(|_| "Job configuration failed")?;
    Ok(job)
}
