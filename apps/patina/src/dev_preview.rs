use crate::Action;
use patina_plugin_host::{Host, Package};
use std::{
    env, fs, io,
    io::Read,
    path::{Path, PathBuf},
    thread,
};

fn session() -> Option<PathBuf> {
    env::var_os("PATINA_DEV_SESSION").map(PathBuf::from)
}

pub(super) fn install_staged(host: &mut Host, bundle: &Package, locale: &str) {
    if let Some(session) = session()
        && let Err(error) = install_from_session(&session, host, bundle, locale)
    {
        eprintln!("Install development plugin {}: {error}", bundle.manifest.id);
    }
}

fn install_from_session(
    session: &Path,
    host: &mut Host,
    bundle: &Package,
    locale: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let id = &bundle.manifest.id;
    let staged = session.join(format!("{id}.zip"));
    let pending = session.join(format!("{id}.installing.zip"));
    if staged.try_exists()? {
        fs::rename(&staged, &pending)?;
    } else if !pending.try_exists()? {
        return Ok(());
    }
    let preview = host.inspect(&pending)?;
    if preview.manifest.id != *id || preview.publisher != bundle.publisher {
        return Err("Staged plugin has a different identity or publisher".into());
    }
    if !preview
        .manifest
        .capabilities
        .iter()
        .all(|capability| bundle.manifest.capabilities.contains(capability))
    {
        return Err("Use the plugin store to approve additional capabilities".into());
    }
    host.install(&pending, &preview, locale)?;
    fs::remove_file(pending)?;
    Ok(())
}

pub(super) fn exit_with_launcher(sender: &async_channel::Sender<Action>) -> io::Result<()> {
    if session().is_some() {
        let sender = sender.clone();
        thread::Builder::new()
            .name("dev-launcher".into())
            .spawn(move || {
                let _ = io::stdin().read(&mut [0]);
                let _ = sender.try_send(Action::Exit);
            })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundled_tools;

    #[test]
    fn staged_install_checks_identity_and_consumes_request()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        let root = dir.path();
        let runtime = tokio::runtime::Runtime::new()?;
        let pool = runtime.block_on(patina_activity::open_database(&root.join("tracker.db")))?;
        let storage = patina_activity::NativeToolData::new(pool, runtime.handle().clone());
        let mut host = Host::open(root.join("tools"))?;
        bundled_tools::configure(&mut host, &storage)?;
        let key = ring::signature::Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new())
            .unwrap();
        let key = ring::signature::Ed25519KeyPair::from_pkcs8(key.as_ref()).unwrap();
        let mut focus = bundled_tools::package("patina.focus")?;
        focus.sign(&key)?;
        let staged = root.join("patina.focus.zip");
        bundled_tools::package("patina.reminders")?.write_zip(fs::File::create(&staged)?)?;
        assert!(install_from_session(root, &mut host, &focus, "zh-CN").is_err());
        assert!(host.list().is_empty());

        host.seed(focus.clone(), "zh-CN")?;
        let mut update = focus.clone();
        update.manifest.version = "1.2.3".into();
        update.sign(&key)?;
        update.write_zip(fs::File::create(&staged)?)?;
        install_from_session(root, &mut host, &focus, "zh-CN")?;
        let installed = host.bound_installation("patina.focus").unwrap();
        assert_eq!(installed.manifest.version, "1.2.3");
        host.uninstall("patina.focus", &installed.generation)?;
        install_from_session(root, &mut host, &focus, "zh-CN")?;
        assert!(host.list().is_empty());
        Ok(())
    }
}
