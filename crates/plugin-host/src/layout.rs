use crate::package::{display_text, identifier};
use patina_plugin_sdk::{Control, layout::*};
use std::collections::HashSet;

fn has_button(panel: &[Control], key: &str) -> bool {
    panel.iter().any(|control| match control {
        Control::Button { id, .. } => id == key,
        Control::ListRow { actions, .. } => actions.iter().any(|(id, _)| id == key),
        _ => false,
    })
}

pub(super) fn valid(page: &Page, panel: &[Control], api: u32, reminders: bool) -> bool {
    let button = |key: &str| has_button(panel, key);
    let supported_icon = |icon| api >= 8 || !matches!(icon, Icon::BellRing);
    if !display_text(&page.title, 256)
        || !supported_icon(page.icon)
        || !(1..=8).contains(&page.tabs.len())
        || page
            .selected_tab
            .as_ref()
            .is_some_and(|id| api < 4 || !page.tabs.iter().any(|t| t.id == *id))
    {
        return false;
    }
    let mut remaining = 512;
    let mut tabs = HashSet::new();
    let mut fields = HashSet::new();
    let mut submits = HashSet::new();
    for tab in &page.tabs {
        if !identifier(&tab.id)
            || !tabs.insert(&tab.id)
            || !display_text(&tab.label, 256)
            || !(display_text(&tab.empty, 512) || tab.layout.is_some() && tab.empty.is_empty())
            || !tab.layout.as_ref().is_none_or(|layout| {
                api >= 3
                    && valid_composition(
                        layout,
                        tab.form.as_ref().map_or(&[], |f| f.fields.as_slice()),
                        Some(tab),
                        panel,
                        &mut remaining,
                    )
            })
            || tab.rows.len() > 256
            || tab.navigation.len() > 16
            || !distinct(tab.navigation.iter())
            || !tab.navigation.iter().all(|key| button(key))
        {
            return false;
        }
        if let Some(form) = &tab.form {
            let mut bindings = Vec::new();
            for field in &form.fields {
                field.bindings(&mut bindings);
            }
            if bindings.len() > 32
                || !reminders
                    && form
                        .fields
                        .iter()
                        .any(|field| matches!(field.editor, Editor::ActivityTarget))
                || !display_text(&form.heading, 256)
                || !submits.insert(&form.submit)
                || !panel
                    .iter()
                    .any(|c| matches!(c, Control::Submit { id, .. } if id == &form.submit))
                || !form.cancel.as_deref().is_none_or(button)
                || !valid_fields(
                    &form.fields,
                    panel,
                    &mut fields,
                    0,
                    false,
                    api,
                    &mut remaining,
                )
            {
                return false;
            }
        }
        if !distinct(tab.rows.iter().map(|row| &row.id))
            || !tab.rows.iter().all(|row| {
                valid_row(row, panel) && row.icons.iter().all(|(_, icon)| supported_icon(*icon))
            })
        {
            return false;
        }
    }
    page.dialog.as_ref().is_none_or(|dialog| {
        supported_icon(dialog.icon)
            && display_text(&dialog.title, 8192)
            && button(&dialog.close)
            && dialog.lines.len() <= 256
            && dialog.lines.iter().all(|s| s.len() <= 8192)
            && dialog.actions.len() <= 32
            && distinct(dialog.actions.iter().chain([&dialog.close]))
            && dialog.actions.iter().all(|key| button(key))
    })
}

fn distinct<'a>(mut keys: impl Iterator<Item = &'a String>) -> bool {
    let mut seen = HashSet::new();
    keys.all(|key| seen.insert(key))
}

fn valid_row(row: &Row, panel: &[Control]) -> bool {
    let Some(Control::ListRow { actions, .. }) = panel
        .iter()
        .find(|c| matches!(c, Control::ListRow { id, .. } if id == &row.id))
    else {
        return false;
    };
    let mut keys = row
        .icons
        .iter()
        .map(|(key, _)| key)
        .chain(row.detail_action.iter());
    distinct(keys.clone()) && keys.all(|key| actions.iter().any(|(id, _)| id == key))
}

fn valid_fields<'a>(
    fields: &'a [Field],
    panel: &[Control],
    ids: &mut HashSet<&'a str>,
    depth: usize,
    in_popup: bool,
    api: u32,
    remaining: &mut usize,
) -> bool {
    if depth > 4 || fields.len() > 32 {
        return false;
    }
    let input = |key: &str| {
        panel
            .iter()
            .any(|c| matches!(c,Control::Input{id,..} if id==key))
    };
    let select = |key: &str| {
        panel
            .iter()
            .any(|c| matches!(c,Control::Select{id,..} if id==key))
    };
    let condition = |c: &Condition| {
        panel.iter().any(|v| matches!(v,Control::Select{id,choices,..} if id==&c.field && choices.iter().any(|(k,_)|k==&c.equals)))
    };
    fields.iter().all(|f| {
        identifier(&f.id)
            && f.width.is_none_or(|w| api >= 3 && (1..=2048).contains(&w))
            && f.weight
                .is_none_or(|w| api >= 6 && w > 0 && f.width.is_none() && !f.grow)
            && ids.len() < 256
            && ids.insert(&f.id)
            && f.visible.as_ref().is_none_or(condition)
            && match &f.editor {
                Editor::Text {
                    placeholder,
                    unit,
                    label_from,
                } => {
                    input(&f.id)
                        && placeholder.len() <= 512
                        && unit.len() <= 64
                        && label_from.as_deref().is_none_or(select)
                }
                Editor::Select {
                    clear_on_change, ..
                } => select(&f.id) && clear_on_change.as_deref().is_none_or(input),
                Editor::Segments => select(&f.id),
                Editor::ActivityTarget => api >= 5 && depth == 0 && input(&f.id),
                Editor::DateTime => !in_popup && input(&f.id),
                Editor::Duration { max_minutes } => {
                    !in_popup && input(&f.id) && (1..=525600).contains(max_minutes)
                }
                Editor::Popover {
                    label,
                    width,
                    arrangement,
                    summaries,
                    fields,
                } => {
                    !in_popup
                        && display_text(label, 256)
                        && (120..=800).contains(width)
                        && valid_arrangement(arrangement, fields, panel, api, remaining)
                        && (1..=16).contains(&summaries.len())
                        && summaries.iter().all(|s| {
                            s.template.len() <= 1024 && s.when.as_ref().is_none_or(condition)
                        })
                        && valid_fields(fields, panel, ids, depth + 1, true, api, remaining)
                }
                Editor::Group {
                    label,
                    arrangement,
                    fields,
                } => {
                    label.len() <= 256
                        && valid_arrangement(arrangement, fields, panel, api, remaining)
                        && valid_fields(fields, panel, ids, depth + 1, in_popup, api, remaining)
                }
            }
    })
}

fn valid_arrangement(
    arrangement: &Arrangement,
    fields: &[Field],
    panel: &[Control],
    api: u32,
    remaining: &mut usize,
) -> bool {
    match arrangement {
        Arrangement::Columns(columns) => (1..=4).contains(columns),
        Arrangement::Layout(layout) => {
            api >= 3 && valid_composition(layout, fields, None, panel, remaining)
        }
    }
}

fn valid_composition(
    layout: &Container,
    fields: &[Field],
    tab: Option<&Tab>,
    panel: &[Control],
    remaining: &mut usize,
) -> bool {
    let mut placed = HashSet::new();
    let mut pending = vec![(layout, 0)];
    while let Some((group, depth)) = pending.pop() {
        if depth > 8
            || group.gap > 256
            || matches!(group.flow, Flow::Grid(n) if !(1..=12).contains(&n))
            || group.wrap && matches!(group.flow, Flow::Grid(_))
            || group.children.len() > *remaining
        {
            return false;
        }
        *remaining -= group.children.len();
        for child in &group.children {
            let (kind, id, allowed) = match child {
                Node::Container(inner) => {
                    pending.push((inner, depth + 1));
                    continue;
                }
                Node::Text(text) => {
                    if text.len() > 8192 {
                        return false;
                    }
                    continue;
                }
                Node::Action(key) => ("action", key.as_str(), has_button(panel, key)),
                Node::Field(key) => ("field", key.as_str(), fields.iter().any(|f| &f.id == key)),
                Node::Title => ("title", "", tab.is_some()),
                Node::Tabs => ("tabs", "", tab.is_some()),
                Node::List => ("list", "", tab.is_some_and(|t| !t.empty.is_empty())),
                Node::FormHeading => ("heading", "", tab.is_some_and(|t| t.form.is_some())),
                Node::Submit => ("submit", "", tab.is_some_and(|t| t.form.is_some())),
                Node::Cancel => ("cancel", "", tab.is_some_and(|t| t.form.is_some())),
            };
            if !allowed || !placed.insert((kind, id)) {
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composition_is_versioned_bounded_and_scoped() {
        let mut page = Page {
            title: "Notes".into(),
            selected_tab: None,
            icon: Icon::ToolCase,
            dialog: None,
            tabs: vec![Tab {
                id: "notes".into(),
                label: "Notes".into(),
                empty: String::new(),
                form: None,
                rows: vec![],
                navigation: vec![],
                layout: None,
            }],
        };
        let controls = [Control::Button {
            id: "save".into(),
            label: "Save".into(),
        }];
        let layout = |nodes| Container::new(Flow::Row, 12, nodes);
        let action = || Node::Action("save".into());
        page.tabs[0].layout = Some(layout(vec![Node::Title, layout(vec![action()]).into()]));
        assert!(valid(&page, &controls, 3, false));
        assert!(!valid(&page, &controls, 2, false));
        page.selected_tab = Some("notes".into());
        assert!(valid(&page, &controls, 4, false));
        assert!(!valid(&page, &controls, 3, false));
        page.selected_tab = Some("absent".into());
        assert!(!valid(&page, &controls, 4, false));
        page.selected_tab = None;
        let mut nested = layout(vec![action()]);
        for _ in 0..9 {
            nested = layout(vec![nested.into()]);
        }
        for invalid in [
            layout(vec![Node::Field("other".into())]),
            layout(vec![Node::Action("missing".into())]),
            layout(vec![Node::Submit]),
            layout(vec![action(), layout(vec![action()]).into()]),
            Container::new(Flow::Grid(0), 4, []),
            Container::new(Flow::Grid(3), 4, []).wrapping(),
            Container::new(Flow::Column, 257, []),
            layout(vec![Node::Text("x".into()); 513]),
            nested,
        ] {
            page.tabs[0].layout = Some(invalid);
            assert!(!valid(&page, &controls, 3, false));
        }
    }

    #[test]
    fn validates_field_types_row_actions_and_unique_ids() {
        let panel = vec![
            Control::Input {
                id: "entry".into(),
                label: "Entry".into(),
                value: String::new(),
            },
            Control::Submit {
                id: "save".into(),
                label: "Save".into(),
            },
            Control::ListRow {
                id: "entry-1".into(),
                title: "One".into(),
                detail: "Details".into(),
                actions: vec![("edit".into(), "Edit".into())],
                clock: None,
            },
        ];
        let row = Row {
            id: "entry-1".into(),
            icons: vec![("edit".into(), Icon::Pencil)],
            detail_action: None,
        };
        let mut page = Page {
            icon: Icon::ToolCase,
            title: "Entries".into(),
            selected_tab: None,
            dialog: None,
            tabs: vec![Tab {
                layout: None,
                id: "all".into(),
                label: "All".into(),
                rows: vec![row.clone()],
                empty: "No entries".into(),
                navigation: vec![],
                form: Some(Form {
                    heading: "Add".into(),
                    fields: vec![Field::new("entry", Editor::text("", ""))],
                    submit: "save".into(),
                    cancel: None,
                }),
            }],
        };
        assert!(valid(&page, &panel, 2, false));
        page.tabs[0].form.as_mut().unwrap().fields[0].weight = Some(3);
        assert!(valid(&page, &panel, 6, false));
        assert!(!valid(&page, &panel, 5, false));
        page.tabs[0].form.as_mut().unwrap().fields[0].weight = Some(0);
        assert!(!valid(&page, &panel, 6, false));
        page.tabs[0].form.as_mut().unwrap().fields[0].weight = None;
        let editor = &mut page.tabs[0].form.as_mut().unwrap().fields[0].editor;
        let original = std::mem::replace(editor, Editor::ActivityTarget);
        assert!(valid(&page, &panel, 5, true));
        assert!(!valid(&page, &panel, 5, false));
        assert!(!valid(&page, &panel, 4, true));
        page.tabs[0].form.as_mut().unwrap().fields[0].editor = original;
        page.tabs[0].rows.push(row);
        assert!(!valid(&page, &panel, 2, false));
        page.tabs[0].rows.pop();
        page.tabs[0].rows[0].detail_action = Some("missing".into());
        assert!(!valid(&page, &panel, 2, false));
        page.tabs[0].rows[0].detail_action = None;
        page.tabs[0].form.as_mut().unwrap().fields[0].editor = Editor::Segments;
        assert!(!valid(&page, &panel, 2, false));
    }
}
