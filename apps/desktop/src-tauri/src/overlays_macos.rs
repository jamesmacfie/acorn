//! AppKit owns ordering and input. The wrapper owns no page, renderer or business state.
use super::Presentation;
use objc2::rc::Retained;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadOnly, Message};
use objc2_app_kit::{
    NSApplication, NSAutoresizingMaskOptions, NSEventType, NSResponder, NSView,
    NSWindowOrderingMode,
};
use objc2_foundation::{MainThreadMarker, NSPoint};
use std::cell::{Cell, RefCell};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Default)]
struct LayerState {
    epoch: Cell<u64>,
    presentation: RefCell<Presentation>,
    last_press: Cell<isize>,
    previous_focus: RefCell<Option<Retained<NSResponder>>>,
    outside: RefCell<Option<Box<dyn Fn(f64, f64)>>>,
}

define_class!(
    // SAFETY: NSView permits subclassing; all access occurs on AppKit's main thread.
    #[unsafe(super = NSView)]
    #[thread_kind = MainThreadOnly]
    #[ivars = LayerState]
    struct AcornRendererLayer;
    impl AcornRendererLayer {
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, point: NSPoint) -> *mut NSView {
            let local = self.convertPoint_fromView(point, unsafe { self.superview() }.as_deref());
            let y = if self.isFlipped() { local.y } else { self.bounds().size.height - local.y };
            let (x, y) = content_point(&self.ivars().presentation.borrow(), self.bounds().size, local.x, y);
            // A failed layer update must not let a stale region swallow input after fallback hides pages.
            let page_visible = unsafe { self.superview() }.is_some_and(|parent| parent.subviews().iter().any(|view|
                !std::ptr::eq(Retained::as_ptr(&view) as *const (), self as *const Self as *const ()) && !view.isHidden() && {
                    let f = view.frame();
                    point.x >= f.origin.x && point.y >= f.origin.y
                        && point.x < f.origin.x + f.size.width && point.y < f.origin.y + f.size.height
                }));
            if page_visible && self.ivars().presentation.borrow().passes_through(x, y) {
                if let Some(event) = NSApplication::sharedApplication(self.mtm()).currentEvent() {
                    if matches!(event.r#type(), NSEventType::LeftMouseDown | NSEventType::RightMouseDown)
                        && self.ivars().last_press.replace(event.eventNumber()) != event.eventNumber() {
                        if let Some(outside) = self.ivars().outside.borrow().as_ref() { outside(x, y); }
                    }
                }
                return std::ptr::null_mut();
            }
            // SAFETY: Exact NSView hitTest signature. Native event dispatch remains AppKit's.
            unsafe { msg_send![super(self), hitTest: point] }
        }
    }
);

fn content_point(p: &Presentation, size: objc2_foundation::NSSize, x: f64, y: f64) -> (f64, f64) {
    match &p.viewport {
        Some(v) if size.width > 0.0 && size.height > 0.0 => {
            (x * v.width / size.width, y * v.height / size.height)
        }
        _ => (x, y),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zoomed_content_coordinates_use_the_css_viewport() {
        let p = Presentation {
            viewport: Some(super::super::Viewport {
                width: 500.,
                height: 400.,
            }),
            ..Default::default()
        };
        assert_eq!(
            content_point(&p, objc2_foundation::NSSize::new(1000., 800.), 600., 200.),
            (300., 100.)
        );
    }
}

pub fn update<R: Runtime>(
    pointer: *mut std::ffi::c_void,
    epoch: u64,
    presentation: Presentation,
    app: AppHandle<R>,
) -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    // SAFETY: with_webview supplied the live WKWebView, an NSView subclass, on the main thread.
    let renderer = unsafe { &*(pointer as *const NSView) };
    let Some(parent) = (unsafe { renderer.superview() }) else {
        return false;
    };
    let layer = if let Some(layer) = parent.downcast_ref::<AcornRendererLayer>() {
        layer.retain()
    } else {
        let allocated = AcornRendererLayer::alloc(mtm).set_ivars(LayerState::default());
        // SAFETY: NSView initialization signature, with Rust ivars initialized above.
        let layer: Retained<AcornRendererLayer> =
            unsafe { msg_send![super(allocated), initWithFrame: renderer.frame()] };
        // WKWebView's accelerated content must remain in a layer-backed ancestor hierarchy.
        layer.setWantsLayer(true);
        layer.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        // Retain through remove/reinsert; Tauri and WebKit still own the same renderer instance.
        let held = renderer.retain();
        renderer.removeFromSuperview();
        parent.addSubview(&layer);
        layer.addSubview(&held);
        let handle = app.clone();
        *layer.ivars().outside.borrow_mut() = Some(Box::new(move |x, y| {
            if let Some(main) = handle.get_webview("main") {
                let _ = main.eval(&format!("document.dispatchEvent(new CustomEvent('acorn:page-press',{{detail:{{x:{x},y:{y}}}}}))"));
            }
        }));
        layer
    };
    if !super::newer(
        epoch,
        presentation.generation,
        layer.ivars().epoch.get(),
        layer.ivars().presentation.borrow().generation,
    ) {
        return false;
    }
    let was_modal = layer
        .ivars()
        .presentation
        .borrow()
        .surfaces
        .iter()
        .any(|s| s.modal);
    let modal = presentation.surfaces.iter().any(|s| s.modal);
    // Background page webviews leave the platform accessibility tree while a covering modal is
    // active. The owner of a plugin page inside a host dialog is excluded from its blocker list.
    if let Some(parent) = unsafe { layer.superview() } {
        for view in parent.subviews().iter() {
            if std::ptr::eq(
                Retained::as_ptr(&view) as *const (),
                Retained::as_ptr(&layer) as *const (),
            ) {
                continue;
            }
            let frame = view.frame();
            let x = frame.origin.x + frame.size.width / 2.0;
            let y = if parent.isFlipped() {
                frame.origin.y + frame.size.height / 2.0
            } else {
                parent.bounds().size.height - frame.origin.y - frame.size.height / 2.0
            };
            let (x, y) = content_point(&presentation, layer.bounds().size, x, y);
            let hidden = presentation.pages.iter().any(|page| {
                page.bounds.contains(x, y)
                    && presentation
                        .surfaces
                        .iter()
                        .any(|s| s.modal && page.blockers.contains(&s.id))
            });
            // SAFETY: Native siblings are live NSViews; the selector is checked before sending.
            unsafe {
                let supported: bool =
                    msg_send![&*view, respondsToSelector: sel!(setAccessibilityHidden:)];
                if supported {
                    let _: () = msg_send![&*view, setAccessibilityHidden: hidden];
                }
            }
        }
    }
    layer.ivars().epoch.set(epoch);
    *layer.ivars().presentation.borrow_mut() = presentation;
    if let Some(parent) = unsafe { layer.superview() } {
        let order = if layer.ivars().presentation.borrow().pages.is_empty() {
            NSWindowOrderingMode::Below
        } else {
            NSWindowOrderingMode::Above
        };
        parent.addSubview_positioned_relativeTo(&layer, order, None);
    }
    if modal && !was_modal {
        if let Some(window) = renderer.window() {
            let previous = window.firstResponder();
            *layer.ivars().previous_focus.borrow_mut() = previous.filter(|responder| {
                responder
                    .downcast_ref::<NSView>()
                    .is_some_and(|view| !view.isDescendantOf(renderer))
            });
            window.makeFirstResponder(Some(renderer));
        }
    }
    if was_modal && !modal {
        if let Some(previous) = layer.ivars().previous_focus.borrow_mut().take() {
            if previous
                .downcast_ref::<NSView>()
                .is_some_and(|view| view.window().is_some() && !view.isHiddenOrHasHiddenAncestor())
            {
                if let Some(window) = renderer.window() {
                    window.makeFirstResponder(Some(&previous));
                }
            }
        }
    }
    true
}

/// Creation and inspector attachment can append native siblings after the renderer.
pub fn raise(pointer: *mut std::ffi::c_void) {
    // SAFETY: Caller is with_webview on the main thread.
    let renderer = unsafe { &*(pointer as *const NSView) };
    if let Some(layer) = unsafe { renderer.superview() } {
        if layer
            .downcast_ref::<AcornRendererLayer>()
            .is_some_and(|layer| !layer.ivars().presentation.borrow().pages.is_empty())
        {
            if let Some(parent) = unsafe { layer.superview() } {
                parent.addSubview_positioned_relativeTo(&layer, NSWindowOrderingMode::Above, None);
            }
        }
    }
}

/// Debug fixture activation, independent of passive overlay focus policy.
pub fn activate_agent() {
    if let Some(mtm) = MainThreadMarker::new() {
        #[allow(deprecated)]
        NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
    }
}
