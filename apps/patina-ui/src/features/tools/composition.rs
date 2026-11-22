use super::{
    Tools,
    fields::{FieldSizing, PanelView},
    panel::icon,
};
use gpui_kit::{prelude::*, *};
use patina_desktop_protocol::tools::layout::{
    Align, Container, Field, Flow, Justify, Node, Page, Surface,
};

#[derive(Clone, Copy)]
pub(super) enum Scope<'a> {
    Page { page: &'a Page, index: usize },
    Fields(&'a [Field]),
}

fn container(layout: &Container, c: quietpro::Palette) -> Div {
    let mut area = match layout.surface {
        Surface::Plain => div(),
        Surface::Card => quietpro::content_card(c.border, c.canvas),
        Surface::Ruled => div().relative().child(quietpro::section_rule(c)),
    }
    .min_w_0()
    .gap(px(f32::from(layout.gap)));
    area = match layout.flow {
        Flow::Row => area.flex().flex_row(),
        Flow::Column => area.flex().flex_col(),
        Flow::Grid(columns) => area.grid().grid_cols(u16::from(columns)),
    }
    .when(layout.wrap, |a| a.flex_wrap());
    area = match layout.align {
        Align::Start => area.items_start(),
        Align::Center => area.items_center(),
        Align::End => area.items_end(),
        Align::Stretch => area.items_stretch(),
    };
    match layout.justify {
        Justify::Start => area.justify_start(),
        Justify::Center => area.justify_center(),
        Justify::End => area.justify_end(),
        Justify::Between => area.justify_between(),
    }
}

struct Frame<'a> {
    layout: &'a Container,
    nodes: std::iter::Enumerate<std::slice::Iter<'a, Node>>,
    children: Vec<AnyElement>,
    position: usize,
}
impl<'a> Frame<'a> {
    fn new(layout: &'a Container, position: usize) -> Self {
        Self {
            layout,
            nodes: layout.children.iter().enumerate(),
            children: Vec::new(),
            position,
        }
    }
    fn finish(self, c: quietpro::Palette) -> AnyElement {
        let group = container(self.layout, c)
            .children(self.children)
            .id(("layout-group", self.position));
        if self.layout.grow {
            group.min_h_0().flex_1()
        } else {
            group.flex_none()
        }
        .into_any_element()
    }
}

impl Tools {
    pub(super) fn compose(
        &mut self,
        layout: &Container,
        scope: Scope<'_>,
        view: PanelView<'_>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let children = self.compose_children(layout, scope, view, win, cx);
        container(layout, view.colors).children(children)
    }

    fn compose_children(
        &mut self,
        layout: &Container,
        scope: Scope<'_>,
        view: PanelView<'_>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let mut stack = vec![Frame::new(layout, 0)];
        loop {
            let current = stack.last_mut().expect("root layout frame");
            match current.nodes.next() {
                Some((position, Node::Container(child))) => stack.push(Frame::new(child, position)),
                Some((position, node)) => {
                    if let Some(element) = self.layout_item(node, position, scope, view, win, cx) {
                        current.children.push(element);
                    }
                }
                None => {
                    let frame = stack.pop().expect("completed layout frame");
                    let Some(parent) = stack.last_mut() else {
                        return frame.children;
                    };
                    parent.children.push(frame.finish(view.colors));
                }
            }
        }
    }

    fn layout_item(
        &mut self,
        node: &Node,
        position: usize,
        scope: Scope<'_>,
        view: PanelView<'_>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        match node {
            Node::Text(text) => Some(
                super::label(text.clone())
                    .id(("layout-text", position))
                    .into_any_element(),
            ),
            Node::Action(key) => self
                .panel_button(key, view.controls, view.colors, view.ready, cx)
                .map(|e| e.into_any_element()),
            Node::Field(key) => {
                let fields = match scope {
                    Scope::Fields(fields) => fields,
                    Scope::Page { page, index } => page.tabs[index]
                        .form
                        .as_ref()
                        .map_or(&[][..], |f| f.fields.as_slice()),
                };
                fields.iter().find(|f| &f.id == key).and_then(|field| {
                    self.render_field(field, FieldSizing::Declared, view, win, cx)
                })
            }
            _ => self.page_item(node, scope, view, win, cx),
        }
    }

    fn page_item(
        &mut self,
        node: &Node,
        scope: Scope<'_>,
        view: PanelView<'_>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let Scope::Page { page, index } = scope else {
            return None;
        };
        let tab = &page.tabs[index];
        let c = view.colors;
        match node {
            Node::Title => Some(
                div()
                    .id("layout-title")
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(quietpro::glyph(icon(page.icon), c.accent).size(px(16.)))
                    .child(
                        quietpro::heading(page.title.clone())
                            .aria_level(2)
                            .line_height(px(24.)),
                    )
                    .into_any_element(),
            ),
            Node::Tabs => self.page_tabs(page, index, view, cx),
            Node::FormHeading => Some(self.form_heading(tab.form.as_ref()?, c).into_any_element()),
            Node::Submit => self
                .submit_button(tab.form.as_ref()?, view, cx)
                .map(|b| b.into_any_element()),
            Node::Cancel => self
                .cancel_button(tab.form.as_ref()?, view, cx)
                .map(|b| b.into_any_element()),
            Node::List => Some(self.task_list(tab, view, win, cx).into_any_element()),
            _ => None,
        }
    }
}
