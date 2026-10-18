use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

const OPEN_LINK_EVENT: &str = "acorn:open-link";

#[derive(Default)]
pub struct PendingLinks(Mutex<Vec<String>>);

impl PendingLinks {
    fn receive(&self, href: String) {
        self.0.lock().unwrap().push(href);
    }

    fn prepend_initial(&self, urls: impl IntoIterator<Item = String>) {
        let mut queue = self.0.lock().unwrap();
        let initial = urls
            .into_iter()
            .filter(|url| !queue.contains(url))
            .collect::<Vec<_>>();
        queue.splice(0..0, initial);
    }

    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

pub(crate) fn receive(app: &AppHandle, href: String) {
    if let Some(pending) = app.try_state::<PendingLinks>() {
        pending.receive(href.clone());
    }
    // The event wakes a subscribed renderer. The queue also retains links received before its
    // listener exists, such as one that opened the window; the renderer drains it after subscribing.
    let _ = app.emit(OPEN_LINK_EVENT, href);
    crate::ensure_window(app);
}

pub fn start(app: &AppHandle) -> Result<(), tauri_plugin_deep_link::Error> {
    app.manage(PendingLinks::default());
    // Subscribe before reading the startup URL. A second URL delivered between those operations
    // must enter the queue, even if the renderer has not opened yet.
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            receive(&handle, url.to_string());
        }
    });
    if let Some(urls) = app.deep_link().get_current()? {
        app.state::<PendingLinks>()
            .prepend_initial(urls.into_iter().map(|url| url.to_string()));
    }
    Ok(())
}

#[tauri::command]
pub fn take_pending_links(app: AppHandle) -> Vec<String> {
    let Some(pending) = app.try_state::<PendingLinks>() else {
        return Vec::new();
    };
    pending.take()
}

#[cfg(test)]
mod tests {
    use super::PendingLinks;

    #[test]
    fn startup_read_preserves_order_when_an_event_arrives_first() {
        let pending = PendingLinks::default();
        pending.receive("acorn://local/settings/later".into());
        pending.prepend_initial(["acorn://local/settings/first".into()]);
        assert_eq!(
            pending.take(),
            [
                "acorn://local/settings/first",
                "acorn://local/settings/later"
            ]
        );
        assert!(pending.take().is_empty());

        pending.receive("acorn://local/settings/same".into());
        pending.prepend_initial(["acorn://local/settings/same".into()]);
        assert_eq!(pending.take(), ["acorn://local/settings/same"]);
    }
}
