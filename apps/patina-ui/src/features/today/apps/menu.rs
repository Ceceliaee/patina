use super::*;
use gpui_kit::base::{Align, POPUP_PRIORITY, Placement, Positioner};
use std::cell::Cell;

pub(super) struct Menu {
    position: Point<Pixels>,
    category: Option<usize>,
    active: usize,
    highlighted: Option<(bool, usize)>,
    category_bounds: Rc<Cell<Bounds<Pixels>>>,
    submenu_bounds: Rc<Cell<Bounds<Pixels>>>,
}

impl Today {
    pub(super) fn show_menu(
        &mut self,
        key: &str,
        position: Point<Pixels>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.writing {
            return;
        }
        self.show(key, true, win, cx);
        self.popup.as_mut().unwrap().menu = Some(Menu {
            position,
            category: None,
            active: 0,
            highlighted: win.last_input_was_keyboard().then_some((false, 0)),
            category_bounds: Default::default(),
            submenu_bounds: Default::default(),
        });
    }

    fn rename(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        let Some(popup) = &self.popup else { return };
        let Some(app) = self
            .summary()
            .and_then(|d| d.apps.iter().find(|a| a.key == popup.key))
        else {
            return;
        };
        let placeholder = self.label("mapping.quickRenamePlaceholder");
        let input = cx.new(|cx| {
            InputState::new(win, cx)
                .default_value(app.name.clone())
                .placeholder(placeholder.clone())
                .validate(|s, _| s.encode_utf16().count() <= 80)
        });
        input.update(cx, |v, cx| {
            v.set_accessibility(
                InputAccessibility::new(Some(Role::TextInput)).with_label(Some(placeholder.into())),
            );
            v.focus(win, cx);
            v.select_all(win, cx);
        });
        cx.subscribe_in(
            &input,
            win,
            |this, _, event: &InputEvent, win, cx| match event {
                InputEvent::PressEnter { .. } => this.save_name(win, cx),
                _ => cx.notify(),
            },
        )
        .detach();
        let popup = self.popup.as_mut().unwrap();
        popup.menu = None;
        popup.name = Some(input);
        cx.notify();
    }

    fn choose_category(&mut self, index: usize, win: &mut Window, cx: &mut Context<Self>) {
        if self.writing {
            return;
        }
        let Some(popup) = &self.popup else { return };
        let Some((id, _)) = self.summary().and_then(|d| d.category_choices.get(index)) else {
            return;
        };
        let write = self
            .client
            .edit_app(popup.key.clone(), AppEdit::Category(id.clone()));
        self.dismiss(win, cx);
        self.save(write, win, cx);
    }

    fn open_categories(&mut self, cx: &mut Context<Self>) {
        let Some(popup) = &mut self.popup else { return };
        let Some(menu) = &mut popup.menu else { return };
        menu.active = 1;
        menu.category = self
            .snapshot
            .as_ref()
            .map(|s| &s.summary)
            .filter(|d| !d.category_choices.is_empty())
            .map(|d| {
                let category = d
                    .apps
                    .iter()
                    .find(|a| a.key == popup.key)
                    .map(|a| &a.category);
                d.category_choices
                    .iter()
                    .position(|(id, _)| Some(id) == category)
                    .unwrap_or(0)
            });
        menu.highlighted = menu.category.map(|index| (true, index));
        cx.notify();
    }

    fn menu_key(&mut self, event: &KeyDownEvent, win: &mut Window, cx: &mut Context<Self>) {
        let Some(menu) = self.popup.as_mut().and_then(|p| p.menu.as_mut()) else {
            return;
        };
        let key = event.keystroke.key.as_str();
        let category = menu.category;
        let count = if category.is_some() {
            self.snapshot
                .as_ref()
                .map_or(0, |s| s.summary.category_choices.len())
        } else {
            2
        };
        let current = category.unwrap_or(menu.active);
        match key {
            "up" | "down" | "home" | "end" if count > 0 => {
                let next = match key {
                    "up" => (current + count - 1) % count,
                    "down" => (current + 1) % count,
                    "home" => 0,
                    _ => count - 1,
                };
                if category.is_some() {
                    menu.category = Some(next);
                } else {
                    menu.active = next;
                }
                menu.highlighted = Some((category.is_some(), next));
                cx.notify();
            }
            "escape" | "left" if category.is_some() => {
                menu.category = None;
                menu.highlighted = Some((false, 1));
                cx.notify();
            }
            "escape" | "tab" => self.dismiss(win, cx),
            "right" if category.is_none() && current == 1 => self.open_categories(cx),
            "enter" | "space" => {
                if let Some(index) = category {
                    self.choose_category(index, win, cx);
                } else if current == 0 {
                    self.rename(win, cx);
                } else {
                    self.open_categories(cx);
                }
            }
            _ => return,
        }
        cx.stop_propagation();
    }

    pub(super) fn context_menu(
        &self,
        popup: &Popup,
        app: &AppUsage,
        data: &DaySummary,
        colors: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<impl IntoElement> {
        let menu = popup.menu.as_ref()?;
        let rename_label = self.label("mapping.quickRename");
        let category_label = self.label(if app.category == "other" {
            "mapping.quickSetCategory"
        } else {
            "mapping.quickChangeCategory"
        });
        let root_width = quietpro::menu_width(win, &rename_label, false).max(quietpro::menu_width(
            win,
            &category_label,
            true,
        ));
        let submenu_width = data
            .category_choices
            .iter()
            .map(|(_, name)| quietpro::menu_width(win, name, false))
            .max()
            .unwrap_or_else(|| quietpro::menu_width(win, "", false));
        let rename = quietpro::menu_item(
            "rename",
            rename_label,
            menu.highlighted == Some((false, 0)),
            false,
            colors,
        )
        .on_hover(cx.listener(|this, hovered, _, cx| {
            if let Some(menu) = this.popup.as_mut().and_then(|p| p.menu.as_mut()) {
                if *hovered {
                    menu.active = 0;
                    menu.category = None;
                    menu.highlighted = Some((false, 0));
                } else if menu.highlighted == Some((false, 0)) {
                    menu.highlighted = None;
                }
                cx.notify();
            }
        }))
        .on_click(cx.listener(|this, _, win, cx| this.rename(win, cx)))
        .on_a11y_action(AccessibleAction::Click, {
            let view = cx.weak_entity();
            move |_, win, cx| {
                let _ = view.update(cx, |this, cx| this.rename(win, cx));
            }
        });
        let category_bounds = menu.category_bounds.clone();
        let categories = quietpro::menu_item(
            "category-menu",
            category_label,
            menu.category.is_some() || menu.highlighted == Some((false, 1)),
            false,
            colors,
        )
        .aria_expanded(menu.category.is_some())
        .child(div().flex_1())
        .child(glyph(Icon::ChevronRight, colors.text).size(px(12.)))
        .relative()
        .child(
            canvas(
                move |bounds, _, _| category_bounds.set(bounds),
                |_, _, _, _| {},
            )
            .absolute()
            .inset_0(),
        )
        .on_hover(cx.listener(|this, hovered, _, cx| {
            if *hovered {
                this.open_categories(cx);
            } else if let Some(menu) = this.popup.as_mut().and_then(|p| p.menu.as_mut())
                && menu.highlighted == Some((false, 1))
            {
                menu.highlighted = None;
                cx.notify();
            }
        }))
        .on_click(cx.listener(|this, _, _, cx| this.open_categories(cx)))
        .on_a11y_action(AccessibleAction::Click, {
            let view = cx.weak_entity();
            move |_, _, cx| {
                let _ = view.update(cx, |this, cx| this.open_categories(cx));
            }
        })
        .on_a11y_action(AccessibleAction::Expand, {
            let view = cx.weak_entity();
            move |_, _, cx| {
                let _ = view.update(cx, |this, cx| this.open_categories(cx));
            }
        })
        .on_a11y_action(AccessibleAction::Collapse, {
            let view = cx.weak_entity();
            move |_, _, cx| {
                let _ = view.update(cx, |this, cx| {
                    if let Some(menu) = this.popup.as_mut().and_then(|p| p.menu.as_mut()) {
                        menu.category = None;
                        cx.notify();
                    }
                });
            }
        });
        let submenu_bounds = menu.submenu_bounds.clone();
        let submenu_open = menu.category.is_some();
        let root = quietpro::menu_surface(
            "app-context-menu",
            format_text(
                self.client.locale.get(),
                "mapping.quickMenuLabel",
                &[("label", app.name.clone())],
            ),
            root_width,
            colors,
        )
        .track_focus(&popup.focus)
        .on_key_down(cx.listener(Self::menu_key))
        .on_mouse_down_out(cx.listener(move |this, e: &MouseDownEvent, win, cx| {
            if !submenu_open || !submenu_bounds.get().contains(&e.position) {
                this.dismiss(win, cx);
            }
        }))
        .child(rename)
        .child(categories);
        let mut overlay = div().absolute().child(
            deferred(
                Positioner::corner(Anchor::TopLeft, menu.position)
                    .margin(px(8.))
                    .occlude()
                    .child(root),
            )
            .with_priority(POPUP_PRIORITY),
        );
        if menu.category.is_some() {
            let mut submenu = quietpro::menu_surface(
                "app-category-menu",
                self.label("mapping.quickCategoryMenuLabel"),
                submenu_width,
                colors,
            );
            for (i, (id, name)) in data.category_choices.iter().enumerate() {
                let selected = app.category == *id;
                submenu = submenu.child(
                    quietpro::menu_item(
                        ("category", i),
                        name.clone(),
                        menu.highlighted == Some((true, i)),
                        selected,
                        colors,
                    )
                    .role(Role::MenuItemRadio)
                    .aria_toggled(if selected {
                        Toggled::True
                    } else {
                        Toggled::False
                    })
                    .on_hover(cx.listener(move |this, hovered, _, cx| {
                        if let Some(menu) = this.popup.as_mut().and_then(|p| p.menu.as_mut()) {
                            if *hovered {
                                menu.category = Some(i);
                                menu.highlighted = Some((true, i));
                            } else if menu.highlighted == Some((true, i)) {
                                menu.highlighted = None;
                            }
                            cx.notify();
                        }
                    }))
                    .on_click(cx.listener(move |this, _, win, cx| this.choose_category(i, win, cx)))
                    .on_a11y_action(AccessibleAction::Click, {
                        let view = cx.weak_entity();
                        move |_, win, cx| {
                            let _ = view.update(cx, |this, cx| this.choose_category(i, win, cx));
                        }
                    }),
                );
            }
            let bounds = menu.submenu_bounds.clone();
            let mut anchor = menu.category_bounds.get();
            anchor.origin.x -= px(quietpro::MENU_FRAME_INSET);
            anchor.size.width += px(2. * quietpro::MENU_FRAME_INSET);
            overlay = overlay.child(
                deferred(
                    Positioner::side(anchor)
                        .placement(Placement::Right)
                        .align(Align::Start)
                        .offset(px(4.))
                        .margin(px(8.))
                        .occlude()
                        .on_position(move |position| bounds.set(position.bounds))
                        .child(submenu.max_h(px(400.)).overflow_y_scroll()),
                )
                .with_priority(POPUP_PRIORITY + 1),
            );
        }
        Some(overlay)
    }
}
