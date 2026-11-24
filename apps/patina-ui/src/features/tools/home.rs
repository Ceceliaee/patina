use super::{Tools, tool_name};
use gpui_kit::{prelude::*, *};

impl Tools {
    pub(super) fn home_grid(
        &self,
        ready: bool,
        colors: quietpro::Palette,
        win: &Window,
        cx: &Context<Self>,
    ) -> Div {
        let locale = self.client.locale.get();
        const MIN_CARD_WIDTH: f32 = 160.;
        let gap = quietpro::APP_CARD_GAP;
        let page_width = crate::windows::main::page_width(win.viewport_size().width);
        let available = f32::from(page_width) - 2. * (quietpro::CONTENT_INSET + 1.);
        let columns = ((available + gap) / (MIN_CARD_WIDTH + gap)).clamp(1., 4.) as u16;
        let mut grid = div().grid().grid_cols(columns).w_full().gap(px(gap));
        for tool in &self.tools {
            let id = SharedString::from(format!("plugin-card-{}", tool.manifest.id));
            let name = tool_name(tool, locale);
            let opening = self.busy
                && self.selected.as_ref().is_some_and(|selected| {
                    selected.manifest.id == tool.manifest.id
                        && selected.generation == tool.generation
                });
            let card = quietpro::choice_card(id, name.clone(), opening, ready, colors)
                .h(px(128.))
                .justify_center()
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_size(px(16.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if ready {
                            colors.text
                        } else {
                            colors.disabled_text
                        })
                        .child(name),
                );
            let tool = tool.clone();
            grid = grid.child(card.on_click(cx.listener(move |this, _, win, cx| {
                this.showing_home = false;
                win.focus(&this.home_focus, cx);
                if this.selected.as_ref().is_some_and(|current| {
                    current.generation == tool.generation && current.manifest.id == tool.manifest.id
                }) && this.controls.is_some()
                {
                    this.refresh_panel(true, cx);
                } else {
                    this.selected = Some(tool.clone());
                    this.controls = None;
                    this.load(None, cx);
                }
            })));
        }
        grid
    }
}
