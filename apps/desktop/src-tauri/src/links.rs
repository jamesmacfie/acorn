use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

const OPEN_LINK_EVENT: &str = "acorn:open-link";

#[derive(Default)]
pub struct PendingLinks(Mutex<Vec<String>>);

fn receive(app: &AppHandle, href: String) {
    if let Some(pending) = app.try_state::<PendingLinks>() {
        pending.0.lock().unwrap().push(href.clone());
    }
    // The event wakes a subscribed renderer. The queue also retains links received before its
    // listener exists; the renderer drains it after subscribing.
    let _ = app.emit(OPEN_LINK_EVENT, href);
    if let Some(window) = app.webview_windows().values().next() {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn start(app: &AppHandle) -> Result<(), tauri_plugin_deep_link::Error> {
    app.manage(PendingLinks::default());
    if let Some(urls) = app.deep_link().get_current()? {
        for url in urls {
            receive(app, url.to_string());
        }
    }
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            receive(&handle, url.to_string());
        }
    });
    Ok(())
}

#[tauri::command]
pub fn take_pending_links(app: AppHandle) -> Vec<String> {
    let Some(pending) = app.try_state::<PendingLinks>() else {
        return Vec::new();
    };
    let links = std::mem::take(&mut *pending.0.lock().unwrap());
    links
}
