use super::protocol::{self, ProbeKind, Request, RequestBody, Response};
use super::ForegroundResponse;
use crate::platform::windows::{app_metadata, audio, foreground, media};
use serde_json::Value;

pub(super) const ARGUMENT: &str = "--patina-native-probe";

pub(crate) fn run_if_requested() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(ARGUMENT)) {
        return None;
    }
    let kind = match args
        .next()
        .and_then(|arg| arg.into_string().ok())
        .as_deref()
    {
        Some("foreground") => ProbeKind::Foreground,
        Some("name") => ProbeKind::Name,
        Some("icon") => ProbeKind::Icon,
        Some("media") => ProbeKind::Media,
        Some("audio") => ProbeKind::Audio,
        Some("shell") => ProbeKind::Shell,
        _ => return Some(2),
    };
    if args.next().is_some() {
        return Some(2);
    }
    Some(if run(kind).is_ok() { 0 } else { 1 })
}

fn run(kind: ProbeKind) -> Result<(), String> {
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    let mut last_id = 0;
    let mut audio_apartment = None;
    let mut audio_probe = None;
    let mut media_probe = None;
    loop {
        // The parent assigns this process to its kill-on-close Job before sending
        // the first frame. No platform call or application bootstrap precedes it.
        let request: Request = protocol::read_frame(&mut input, protocol::REQUEST_LIMIT)?;
        if request.version != protocol::VERSION
            || request.id <= last_id
            || !request.body.accepts_kind(kind)
        {
            return Err("probe request identity invalid".into());
        }
        if last_id == 0 {
            super::fault::FaultSlot::install()?;
        }
        last_id = request.id;
        super::fault::phase(last_id, 2);
        // WASAPI may retain internal callbacks between queries. Keep the worker's
        // MTA alive until its pipe loop exits instead of tearing it down per poll.
        // Initialization follows the first validated frame, after Job assignment.
        if kind == ProbeKind::Audio && audio_apartment.is_none() {
            audio_apartment = Some(audio::ComGuard::initialize()?);
        }
        #[cfg(debug_assertions)]
        let fixture = super::fixture::load()?;
        #[cfg(debug_assertions)]
        let body = match fixture.as_ref() {
            Some(fixture) => fixture.request(kind, request.body),
            None => request.body,
        };
        #[cfg(not(debug_assertions))]
        let body = request.body;
        #[cfg(debug_assertions)]
        let result = fixture
            .as_ref()
            .and_then(|fixture| fixture.response(&body))
            .unwrap_or_else(|| execute(body, &mut media_probe, &mut audio_probe));
        #[cfg(not(debug_assertions))]
        let result = execute(body, &mut media_probe, &mut audio_probe);
        let icon = crate::platform::windows::icon::icon_result_cache_stats();
        let (shell_entries, shell_bytes) = app_metadata::shell_cache_stats();
        let details = foreground::process_details_cache_stats();
        let (process_identities, process_identity_bytes) =
            crate::platform::windows::packaged_app::process_identity_cache_stats();
        let response = Response {
            version: protocol::VERSION,
            id: request.id,
            result,
            caches: protocol::ProbeCacheCounts {
                process_details: details.entries,
                process_details_bytes: details.estimated_bytes,
                process_identities,
                process_identity_bytes,
                icon_results: icon.entries,
                icon_bytes: icon.estimated_bytes,
                shell_entries,
                shell_bytes,
            },
            shell: super::shell_diagnostics(),
        };
        super::fault::phase(last_id, 3);
        protocol::write_frame(&mut output, &response, protocol::RESPONSE_LIMIT)?;
        super::fault::phase(last_id, 1);
        if kind == ProbeKind::Shell {
            return Ok(());
        }
    }
}

fn encode(value: impl serde::Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|_| "probe result encoding failed".into())
}

fn execute(
    body: RequestBody,
    media_probe: &mut Option<media::MediaSessionProbe>,
    audio_probe: &mut Option<audio::AudioSessionProbe>,
) -> Result<Value, String> {
    match body {
        RequestBody::Foreground { afk_threshold_secs } => {
            foreground::cmd_set_afk_threshold(afk_threshold_secs);
            let window = foreground::get_active_window_native();
            encode(ForegroundResponse {
                app_user_model_id: window.app_user_model_id.clone(),
                window,
            })
        }
        RequestBody::Name {
            process_path,
            app_user_model_id,
        } => encode(app_metadata::resolve_app_display_name_native(
            &process_path,
            &app_user_model_id,
        )),
        RequestBody::Icon(request) => encode(app_metadata::resolve_icon_base64_native(
            request.process_id,
            &request.process_path,
            &request.exe_name,
            &request.app_user_model_id,
            &request.window_class,
            &request.root_owner_hwnd,
            &request.hwnd,
        )),
        RequestBody::Media => {
            if media_probe.is_none() {
                *media_probe = Some(media::MediaSessionProbe::new()?);
            }
            encode(
                media_probe
                    .as_ref()
                    .ok_or("media probe unavailable")?
                    .query()?,
            )
        }
        RequestBody::Audio { timestamp_ms } => {
            if audio_probe.is_none() {
                *audio_probe = Some(audio::AudioSessionProbe::new()?);
            }
            encode(
                audio_probe
                    .as_mut()
                    .ok_or("audio probe unavailable")?
                    .query(timestamp_ms)?,
            )
        }
        RequestBody::Shell {
            app_user_model_id,
            icon,
        } => encode(app_metadata::request_shell_value_native(
            &app_user_model_id,
            icon,
        )),
        #[cfg(debug_assertions)]
        RequestBody::Test(action) => match action {
            protocol::TestAction::ResourceSnapshot => {
                encode(super::super::resource::current_process_resource_snapshot())
            }
            protocol::TestAction::ApartmentIsMta => {
                use windows::Win32::System::Com::{CoGetApartmentType, APTTYPE_MTA};
                let (mut apartment, mut qualifier) = Default::default();
                encode(
                    unsafe { CoGetApartmentType(&mut apartment, &mut qualifier) }.is_ok()
                        && apartment == APTTYPE_MTA,
                )
            }
            protocol::TestAction::Echo(value) => encode(value),
            protocol::TestAction::Busy => loop {
                std::hint::spin_loop();
            },
            protocol::TestAction::Crash => std::process::exit(17),
            protocol::TestAction::AccessViolation => super::fault::access_violation(),
            protocol::TestAction::StalledAccessViolation => {
                super::fault::stall_after_exception_record();
                super::fault::access_violation()
            }
            protocol::TestAction::ShellAccessViolation => {
                let result: Result<serde_json::Value, _> = super::call(
                    ProbeKind::Shell,
                    RequestBody::Test(protocol::TestAction::AccessViolation),
                );
                encode(result.is_err())
            }
            protocol::TestAction::IdleAccessViolation => {
                std::thread::spawn(|| {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    super::fault::access_violation()
                });
                encode(true)
            }
            protocol::TestAction::ShellUncached {
                app_user_model_id,
                icon,
            } => encode(super::shell(&app_user_model_id, icon)),
            protocol::TestAction::WrongResponse => {
                protocol::write_frame(
                    &mut std::io::stdout(),
                    &Response {
                        version: protocol::VERSION + 1,
                        id: 0,
                        result: Ok(Value::Null),
                        caches: Default::default(),
                        shell: None,
                    },
                    protocol::RESPONSE_LIMIT,
                )?;
                std::process::exit(19)
            }
            protocol::TestAction::PartialResponse => {
                use std::io::Write;
                let mut output = std::io::stdout();
                let _ = output.write_all(&[16, 0, 0, 0, b'{']);
                let _ = output.flush();
                loop {
                    std::thread::park();
                }
            }
            protocol::TestAction::SpawnBusyDescendant => {
                let executable =
                    std::env::current_exe().map_err(|_| "test executable unavailable")?;
                let child = super::process::ProbeProcess::start(&executable, ProbeKind::Shell)?;
                child.request(Request {
                    version: protocol::VERSION,
                    id: 1,
                    body: RequestBody::Test(protocol::TestAction::Busy),
                })?;
                let pid = child.id();
                // This debug-only fault leaves ownership to the OS. The test
                // crashes this parent and checks kill-on-close before cleanup.
                std::mem::forget(child);
                encode(pid)
            }
            protocol::TestAction::Malformed => {
                use std::io::Write;
                let _ = std::io::stdout().write_all(&u32::MAX.to_le_bytes());
                std::process::exit(18)
            }
        },
    }
}
