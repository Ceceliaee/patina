use super::{Event, Host, LoadedPlugin, Request, locales, now_ms, package};
use patina_plugin_sdk::notification::{NoticeContent, NoticeContext};
use std::collections::HashSet;

impl Host {
    pub fn describe_notice(
        &mut self,
        id: &str,
        generation: &str,
        notice: &NoticeContext,
        locale: &str,
    ) -> Result<Option<NoticeContent>, String> {
        let record = self.current(id, generation)?;
        let manifest = &record.files.as_ref().unwrap().manifest;
        if manifest.api < 7 {
            return Ok(None);
        }
        let state = record.state.clone();
        let now = now_ms();
        let data = self
            .data_for(manifest)?
            .map(|store| store.read(locale, now, &state))
            .transpose()?
            .unwrap_or_default();
        if !self.loaded.contains_key(id) {
            let loaded = LoadedPlugin::new(&self.read_installed(id)?)?;
            self.loaded.insert(id.to_owned(), loaded);
        }
        let plugin = self.loaded.get_mut(id).unwrap();
        if !plugin.wasm.function_exists("notification") {
            return Ok(None);
        }
        let request = Request {
            state,
            data,
            locale: locale.into(),
            now_ms: now,
            messages: locales::select(&plugin.locales, locale),
            event: Event::Notification {
                notice: notice.clone(),
                action: None,
            },
        };
        let bytes = plugin
            .wasm
            .call::<_, &[u8]>(
                "notification",
                serde_json::to_vec(&request).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        if bytes.len() > 16 * 1024 {
            return Err("Notification content exceeds 16 KiB".into());
        }
        let content: NoticeContent = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        let valid_text = package::display_text;
        let mut ids = HashSet::new();
        if !valid_text(&content.title, 1024)
            || content.detail.len() > 2048
            || !(1..=2).contains(&content.actions.len())
            || content.choices.as_ref().is_some_and(|c| {
                content.actions.len() != 1
                    || !valid_text(&c.label, 160)
                    || !(1..=6).contains(&c.options.len())
            })
            || !content
                .actions
                .iter()
                .chain(content.choices.iter().flat_map(|c| &c.options))
                .all(|(id, label)| {
                    package::identifier(id) && ids.insert(id) && valid_text(label, 160)
                })
        {
            return Err("Invalid notification content or actions".into());
        }
        Ok(Some(content))
    }

    pub fn apply_notice_action(
        &mut self,
        id: &str,
        generation: &str,
        notice: NoticeContext,
        choice: &str,
        locale: &str,
    ) -> Result<bool, String> {
        let Some(content) = self.describe_notice(id, generation, &notice, locale)? else {
            return Ok(false);
        };
        if !content.offers(choice) {
            return Err("Unknown notification action".into());
        }
        self.dispatch(
            id,
            generation,
            Event::Notification {
                notice,
                action: Some(choice.into()),
            },
            locale,
            now_ms(),
        )?;
        Ok(true)
    }
}
