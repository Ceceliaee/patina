// Copyright 2022 The AccessKit Authors. All rights reserved.
// Licensed under the Apache License, Version 2.0 (found in
// the LICENSE-APACHE file) or the MIT license (found in
// the LICENSE-MIT file), at your option.

use accesskit::{
    Action, ActionHandler, ActionRequest, ActivationHandler, Node, NodeId, Role, Tree, TreeId,
    TreeUpdate,
};

use super::*;

const WINDOW_TITLE: &str = "Simple test";

const WINDOW_ID: NodeId = NodeId(0);
const BUTTON_1_ID: NodeId = NodeId(1);
const BUTTON_2_ID: NodeId = NodeId(2);

fn make_button(label: &str) -> Node {
    let mut node = Node::new(Role::Button);
    node.set_label(label);
    node.add_action(Action::Focus);
    node
}

fn get_initial_state() -> TreeUpdate {
    let mut root = Node::new(Role::Window);
    root.set_children(vec![BUTTON_1_ID, BUTTON_2_ID]);
    let button_1 = make_button("Button 1");
    let button_2 = make_button("Button 2");
    TreeUpdate {
        nodes: vec![
            (WINDOW_ID, root),
            (BUTTON_1_ID, button_1),
            (BUTTON_2_ID, button_2),
        ],
        tree: Some(Tree::new(WINDOW_ID)),
        tree_id: TreeId::ROOT,
        focus: BUTTON_1_ID,
    }
}

pub struct NullActionHandler;

impl ActionHandler for NullActionHandler {
    fn do_action(&mut self, _request: ActionRequest) {}
}

struct SimpleActivationHandler;

impl ActivationHandler for SimpleActivationHandler {
    fn request_initial_tree(&mut self) -> Option<TreeUpdate> {
        Some(get_initial_state())
    }
}

fn scope<F>(f: F) -> Result<()>
where
    F: FnOnce(&Scope) -> Result<()>,
{
    super::scope(
        WINDOW_TITLE,
        SimpleActivationHandler {},
        NullActionHandler {},
        f,
    )
}

#[test]
fn has_native_uia() -> Result<()> {
    scope(|s| {
        let has_native_uia: bool = unsafe { UiaHasServerSideProvider(s.window.0) }.into();
        assert!(has_native_uia);
        Ok(())
    })
}

#[test]
fn geometry_after_window_destruction() -> Result<()> {
    let _lock = MUTEX.lock();
    let hwnd = unsafe {
        CreateWindowExW(
            Default::default(),
            w!("STATIC"),
            None,
            WS_POPUP,
            50,
            60,
            160,
            120,
            None,
            None,
            None,
            None,
        )?
    };
    let mut update = get_initial_state();
    update.nodes[0]
        .1
        .set_bounds(accesskit::Rect::new(2., 3., 22., 33.));
    let context = crate::context::Context::new(
        hwnd.into(),
        accesskit_consumer::Tree::new(update, true),
        Arc::new(ActionHandlerWrapper::new(NullActionHandler)),
        false,
    );
    let root = crate::node::PlatformNode::unspecified_root(&context);
    let fragment: IRawElementProviderFragment = root.into_interface();
    let from_point: IRawElementProviderFragmentRoot = fragment.cast()?;
    let rect = unsafe { fragment.BoundingRectangle()? };
    let mut origin = POINT::default();
    unsafe { windows::Win32::Graphics::Gdi::ClientToScreen(hwnd, &mut origin) }.ok()?;
    assert_eq!(
        (rect.left, rect.top),
        (f64::from(origin.x) + 2., f64::from(origin.y) + 3.)
    );
    assert_eq!((rect.width, rect.height), (20., 30.));
    unsafe { DestroyWindow(hwnd)? };
    // Model a provider request that already upgraded its weak Context when the HWND closed.
    let unavailable = HRESULT(UIA_E_ELEMENTNOTAVAILABLE as i32);
    assert_eq!(
        unsafe { fragment.BoundingRectangle() }.unwrap_err().code(),
        unavailable
    );
    assert_eq!(
        unsafe { from_point.ElementProviderFromPoint(rect.left, rect.top) }
            .unwrap_err()
            .code(),
        unavailable
    );
    Ok(())
}

fn is_button_named(element: &IUIAutomationElement, expected_name: &str) -> bool {
    let control_type = unsafe { element.CurrentControlType() }.unwrap();
    let name = unsafe { element.CurrentName() }.unwrap();
    let name: String = name.try_into().unwrap();
    control_type == UIA_ButtonControlTypeId && name == expected_name
}

fn is_button_1(element: &IUIAutomationElement) -> bool {
    is_button_named(element, "Button 1")
}

fn is_button_2(element: &IUIAutomationElement) -> bool {
    is_button_named(element, "Button 2")
}

#[test]
fn navigation() -> Result<()> {
    scope(|s| {
        let root = unsafe { s.uia.ElementFromHandle(s.window.0) }?;
        let walker = unsafe { s.uia.ControlViewWalker() }?;

        // The children of the window include the children that we provide,
        // but also the title bar provided by the OS. We know that our own
        // children are in the order we specified, but we don't know
        // their position relative to the title bar. In fact, Windows
        // has changed this in the past.
        //
        // Note that a UIA client would normally use the UIA condition feature
        // to traverse the tree looking for an element that meets
        // some condition. But we want to be explicit about navigating
        // forward (and backward below) through only the immediate children.
        // We'll accept the performance hit of multiple cross-thread calls
        // (insignificant in this case) to achieve that.
        let mut button_1_forward: Option<IUIAutomationElement> = None;
        let mut wrapped_child = unsafe { walker.GetFirstChildElement(&root) };
        while let Ok(child) = wrapped_child {
            if is_button_1(&child) {
                button_1_forward = Some(child);
                break;
            }
            wrapped_child = unsafe { walker.GetNextSiblingElement(&child) };
        }
        let button_1_forward = button_1_forward.unwrap();

        let mut button_2_forward: Option<IUIAutomationElement> = None;
        let wrapped_child = unsafe { walker.GetNextSiblingElement(&button_1_forward) };
        if let Ok(child) = wrapped_child {
            if is_button_2(&child) {
                button_2_forward = Some(child);
            }
        }
        let _button_2_forward = button_2_forward.unwrap();

        let mut button_2_backward: Option<IUIAutomationElement> = None;
        let mut wrapped_child = unsafe { walker.GetLastChildElement(&root) };
        while let Ok(child) = wrapped_child {
            if is_button_2(&child) {
                button_2_backward = Some(child);
                break;
            }
            wrapped_child = unsafe { walker.GetPreviousSiblingElement(&child) };
        }
        let button_2_backward = button_2_backward.unwrap();

        let mut button_1_backward: Option<IUIAutomationElement> = None;
        let wrapped_child = unsafe { walker.GetPreviousSiblingElement(&button_2_backward) };
        if let Ok(child) = wrapped_child {
            if is_button_1(&child) {
                button_1_backward = Some(child);
            }
        }
        let button_1_backward = button_1_backward.unwrap();

        let equal: bool =
            unsafe { s.uia.CompareElements(&button_1_forward, &button_1_backward) }?.into();
        assert!(equal);

        let parent = unsafe { walker.GetParentElement(&button_1_forward) }?;
        let equal: bool = unsafe { s.uia.CompareElements(&parent, &root) }?.into();
        assert!(equal);

        let desktop_root = unsafe { s.uia.GetRootElement() }?;
        let parent = unsafe { walker.GetParentElement(&root) }?;
        let equal: bool = unsafe { s.uia.CompareElements(&parent, &desktop_root) }?.into();
        assert!(equal);

        let wrapped_child = unsafe { walker.GetFirstChildElement(&button_1_forward) };
        assert_eq!(Err(Error::empty()), wrapped_child);

        let wrapped_child = unsafe { walker.GetLastChildElement(&button_1_forward) };
        assert_eq!(Err(Error::empty()), wrapped_child);

        Ok(())
    })
}

#[test]
fn focus() -> Result<()> {
    scope(|s| {
        let (focus_event_handler, received_focus_event) = FocusEventHandler::new();
        unsafe {
            s.uia
                .AddFocusChangedEventHandler(None, &focus_event_handler)
        }?;

        s.show_and_focus_window();
        let focus_from_event = received_focus_event.wait(is_button_1);
        let has_focus: bool = unsafe { focus_from_event.CurrentHasKeyboardFocus() }?.into();
        assert!(has_focus);
        let is_focusable: bool = unsafe { focus_from_event.CurrentIsKeyboardFocusable() }?.into();
        assert!(is_focusable);

        let focus_on_demand = unsafe { s.uia.GetFocusedElement() }?;
        let equal: bool =
            unsafe { s.uia.CompareElements(&focus_from_event, &focus_on_demand) }?.into();
        assert!(equal);

        Ok(())
    })
}
