use super::*;
use patina_recorder::{ExportDataRequest, Recorder, StorageRequest as R};
use serde_json::json;

#[test]
fn storage_round_trip_and_migration() -> Result<(), Error> {
    let root = tempfile::tempdir()?;
    let profile = root.path().join("profile");
    fs::create_dir(&profile)?;
    let profile = profile.canonicalize()?;
    let db = profile.join("patina.db");
    seed(&db)?;
    let recorder = Recorder::start_in_profile(&db, &profile, || {})?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let request = |r| rt.block_on(recorder.storage(r));
    let csv = root.path().join("input.csv");
    fs::write(
        &csv,
        "record_type,start_time,end_time,duration_ms,exe_name,app_name,title,category\nexact_session,2024-01-01T05:00:00Z,2024-01-01T05:01:00Z,60000,fixture.exe,Fixture,Sample,\n",
    )?;
    let file = csv.to_str().unwrap().to_owned();
    let preview = request(R::PreviewCsv(file.clone()))?;
    assert_eq!(preview["validRecords"], 1);
    let import = || R::Import {
        path: file.clone(),
        fingerprint: preview["fileFingerprint"].as_str().unwrap().into(),
    };
    let imported = request(import())?;
    assert_eq!(imported["importedRecords"], 1);
    assert_eq!(request(import())?["duplicateRecords"], 1);
    let id = imported["batchId"].as_str().unwrap().to_owned();
    for format in ["csv", "markdown", "parquet", "sqlite"] {
        let path = root.path().join(format!("history.{format}"));
        assert!(
            request(R::Export(ExportDataRequest {
                format: format.into(),
                output_path: path.to_string_lossy().into(),
                start_time: None,
                end_time: None,
                selected_fields: None
            }))?
            .as_u64()
            .unwrap()
                > 0
        );
        assert!(path.metadata()?.len() > 0);
    }
    assert!(request(R::Backup(db.clone())).is_err());
    let archive = root.path().join("snapshot.zip");
    request(R::Backup(archive.clone()))?;
    request(R::DeleteBatch(id.clone()))?;
    let preview = request(R::PreviewRestore(archive.to_string_lossy().into()))?;
    assert!(
        request(R::Restore {
            hash: "bad".into(),
            replace: false
        })
        .is_err()
    );
    request(R::Restore {
        hash: preview["hash"].as_str().unwrap().into(),
        replace: false,
    })?;
    assert!(
        request(R::Batches)?
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["sourceName"] == "input.csv")
    );
    let preview = request(R::PreviewRestore(archive.to_string_lossy().into()))?;
    request(R::Restore {
        hash: preview["hash"].as_str().unwrap().into(),
        replace: true,
    })?;
    assert!(
        request(R::Batches)?
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["id"] == id)
    );
    request(R::Cleanup(180))?;
    assert!(
        !request(R::Batches)?
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["id"] == id)
    );
    let out = root.path().join("automatic");
    fs::create_dir(&out)?;
    for backup in [false, true] {
        let mut input =
            json!({"enabled":true,"cadence":"weekly","weekday":2,"localTimeMinutes":1260});
        if backup {
            input["target"] = json!({"kind":"local","targetDir":out});
        } else {
            input["format"] = json!("csv");
            input["targetDir"] = json!(out);
            input["selectedFields"] = json!(["app_name", "start_time"]);
        }
        assert_eq!(
            request(R::SaveSchedule { backup, input })?["config"]["enabled"],
            true
        );
        assert_eq!(request(R::Schedule { backup })?["config"]["weekday"], 2);
    }
    let next = root.path().join("moved");
    fs::create_dir(&next)?;
    let occupied = next.join("patina.db");
    fs::write(&occupied, b"keep")?;
    assert!(request(R::Move(Some(next.clone()))).is_err());
    assert_eq!(fs::read(&occupied)?, b"keep");
    fs::remove_file(&occupied)?;
    request(R::Move(Some(next.clone())))?;
    recorder.shutdown()?;
    drop(recorder);
    // A file created by another process after confirmation must survive restart.
    fs::write(&occupied, b"keep")?;
    assert_eq!(patina_recorder::database_for_profile(&profile)?, db);
    assert_eq!(fs::read(&occupied)?, b"keep");
    let state: serde_json::Value =
        serde_json::from_slice(&fs::read(profile.join("database-location.json"))?)?;
    assert!(state["pending"].is_null());
    assert!(state["move_error"].is_string());
    fs::remove_file(&occupied)?;
    // Resume after the new DB has been published but the active pointer still names the source.
    let stage = next.join(".patina-move-fixture");
    fs::copy(&db, &stage)?;
    fs::hard_link(&stage, &occupied)?;
    fs::write(
        profile.join("database-location.json"),
        serde_json::to_vec(&json!({"active":profile,"pending":next,"staged":stage}))?,
    )?;
    let moved = patina_recorder::database_for_profile(&profile)
        .map_err(|e| format!("apply directory move: {e}"))?;
    assert_eq!(moved.canonicalize()?, occupied.canonicalize()?);
    let moved_recorder = Recorder::start_in_profile(&moved, &profile, || {})?;
    let settings = rt.block_on(moved_recorder.storage(R::Schedule { backup: true }))?;
    assert_eq!(settings["config"]["weekday"], 2);
    rt.block_on(moved_recorder.storage(R::Move(None)))?;
    moved_recorder.shutdown()?;
    drop(moved_recorder);
    assert_eq!(
        patina_recorder::database_for_profile(&profile)?.canonicalize()?,
        db.canonicalize()?
    );
    Ok(())
}

#[test]
#[ignore = "Windows Credential Manager and loopback WebDAV fixture"]
fn storage_webdav_round_trip() -> Result<(), Error> {
    use std::{
        collections::HashMap,
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        time::Duration,
    };
    let root = tempfile::tempdir()?;
    let profile = root.path().join("profile");
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    seed(&db)?;
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let address = listener.local_addr()?;
    listener.set_nonblocking(true)?;
    let done = Arc::new(AtomicBool::new(false));
    let stop = done.clone();
    let server = std::thread::spawn(move || -> std::io::Result<()> {
        let mut objects = HashMap::<String, Vec<u8>>::new();
        while !stop.load(Ordering::Acquire) {
            let (stream, _) = match listener.accept() {
                Ok(pair) => pair,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                }
                Err(e) => return Err(e),
            };
            stream.set_nonblocking(false)?;
            stream.set_read_timeout(Some(Duration::from_secs(5)))?;
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            reader.read_line(&mut line)?;
            let mut parts = line.split_whitespace();
            let method = parts.next().unwrap_or("").to_owned();
            let path = parts.next().unwrap_or("").to_owned();
            let mut length = 0;
            let mut credential = false;
            let mut create_only = false;
            loop {
                line.clear();
                if reader.read_line(&mut line)? == 0 || line == "\r\n" {
                    break;
                }
                if let Some((k, v)) = line.split_once(':') {
                    if k.eq_ignore_ascii_case("content-length") {
                        length = v.trim().parse().unwrap();
                    }
                    if k.eq_ignore_ascii_case("authorization") {
                        credential = v.trim() == "Basic Zml4dHVyZTpmaXh0dXJlLXNlY3JldA==";
                    }
                    if k.eq_ignore_ascii_case("if-none-match") {
                        create_only = v.trim() == "*";
                    }
                }
            }
            let mut data = vec![0; length];
            reader.read_exact(&mut data)?;
            let (code, response) = if !credential {
                ("401 Unauthorized", vec![])
            } else {
                match method.as_str() {
                    "PROPFIND" => {
                        let xml = format!(
                            r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>{path}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#
                        );
                        ("207 Multi-Status", xml.into_bytes())
                    }
                    "PUT" if create_only && objects.contains_key(&path) => {
                        ("412 Precondition Failed", vec![])
                    }
                    "PUT" => {
                        objects.insert(path, data);
                        ("201 Created", vec![])
                    }
                    "GET" => match objects.get(&path) {
                        Some(value) => ("200 OK", value.clone()),
                        None => ("404 Not Found", vec![]),
                    },
                    _ => ("405 Method Not Allowed", vec![]),
                }
            };
            let mut stream = reader.into_inner();
            write!(
                stream,
                "HTTP/1.1 {code}\r\nContent-Length: {}\r\nETag: \"fixture\"\r\nConnection: close\r\n\r\n",
                response.len()
            )?;
            stream.write_all(&response)?;
        }
        Ok(())
    });
    let recorder = Recorder::start_in_profile(&db, &profile, || {})?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let request = |r| rt.block_on(recorder.storage(r));
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<(), Error> {
        request(R::DavSave {
            url: format!("http://{address}"),
            username: "fixture".into(),
            directory: "/backup".into(),
            password: Some("fixture-secret".into()),
        })?;
        request(R::DavTest {
            url: format!("http://{address}"),
            username: "fixture".into(),
            directory: "/backup".into(),
            password: None,
        })?;
        let upload = |directory: &str| R::DavUpload {
            file: "Fixture snapshot.zip".into(),
            url: format!("http://{address}"),
            username: "fixture".into(),
            directory: directory.into(),
        };
        assert!(request(upload("/different")).is_err());
        let uploaded = request(upload("/backup"))?;
        assert_eq!(
            request(upload("/backup")).unwrap_err(),
            "remote_name_conflict"
        );
        assert_eq!(
            uploaded["indexUpdated"], true,
            "{}",
            uploaded["indexMessage"]
        );
        let list = request(R::DavList)?;
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["fileName"], "Fixture snapshot.zip");
        let preview = request(R::DavDownload(list[0]["id"].as_str().unwrap().into()))?;
        assert_eq!(preview["restore_supported"], true);
        Ok(())
    }));
    let cleared = request(R::DavClear);
    done.store(true, Ordering::Release);
    server.join().unwrap()?;
    cleared?;
    match result {
        Ok(result) => result,
        Err(panic) => std::panic::resume_unwind(panic),
    }
}
