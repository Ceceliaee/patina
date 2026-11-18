use super::*;
use crate::features::source_icon::favicon;

impl History {
    pub(super) fn load_favicons(&mut self, cx: &mut Context<Self>) {
        if self.favicon_read.is_some() {
            return;
        }
        let Some(day) = (if self.web {
            self.data.as_ref()
        } else {
            self.web_data.as_ref()
        }) else {
            return;
        };
        let missing: Vec<_> = day
            .favicons
            .iter()
            .filter(|(key, url)| self.icons.get(*key).and_then(|i| i.source.as_ref()) != Some(*url))
            .map(|(key, url)| (key.clone(), url.clone()))
            .collect();
        if missing.is_empty() {
            return;
        }
        let renderer = cx.svg_renderer();
        self.favicon_read = Some(cx.spawn(async move |view, cx| {
            for (key, source) in missing {
                let url = source.clone();
                let executor = cx.background_executor().clone();
                let renderer = renderer.clone();
                let bytes = cx
                    .background_executor()
                    .spawn(async move { favicon(&url, &executor, renderer).await })
                    .await;
                if view
                    .update(cx, |this, cx| {
                        if !(if this.web {
                            this.data.as_ref()
                        } else {
                            this.web_data.as_ref()
                        })
                        .is_some_and(|d| d.favicons.get(&key) == Some(&source))
                        {
                            return;
                        }
                        if let Some(bytes) = bytes {
                            this.icons.insert(
                                key,
                                HistoryIcon {
                                    color: patina_activity_model::icon_color(&bytes),
                                    image: Arc::new(Image::from_bytes(ImageFormat::Png, bytes)),
                                    source: Some(source),
                                },
                            );
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    return;
                }
            }
            let _ = view.update(cx, |this, _| this.favicon_read = None);
        }));
    }
}
