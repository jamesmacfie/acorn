use mac_notification_sys::{Notification, NotificationResponse};
use tauri::{AppHandle, Emitter, Manager};

// macOS reports the clicked banner through its notification delegate. Keep the waiting off
// the UI thread and retain each notice's tag with its own response, rather than remembering
// the last banner globally. Focus, dismissal, and delivery are not navigation requests.
pub fn show(app: AppHandle, title: String, body: Option<String>, tag: String) -> bool {
    // A bare dev binary needs an installed identity. Prefer acorn when available; Terminal
    // remains the fallback used by Tauri. Packaged builds use their own configured identity.
    let identity = if tauri::is_dev() {
        mac_notification_sys::get_bundle_identifier("acorn")
            .unwrap_or_else(|| "com.apple.Terminal".into())
    } else {
        app.config().identifier.clone()
    };
    if mac_notification_sys::set_application(&identity).is_err() {
        return false;
    }
    std::thread::Builder::new()
        .name("notification-response".into())
        .spawn(move || {
            let response = mac_notification_sys::send_notification(
                &title,
                None,
                body.as_deref().unwrap_or(""),
                Some(Notification::new().wait_for_click(true)),
            );
            let Some(tag) = response.ok().and_then(|response| activation_tag(tag, response)) else {
                return;
            };
            let activated = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(window) = activated.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = activated.emit("acorn:notification-activated", tag);
            });
        })
        .is_ok()
}

fn activation_tag(tag: String, response: NotificationResponse) -> Option<String> {
    (response == NotificationResponse::Click).then_some(tag)
}

#[cfg(test)]
mod tests {
    use super::activation_tag;
    use mac_notification_sys::NotificationResponse;

    #[test]
    fn only_a_content_click_requests_navigation() {
        assert_eq!(activation_tag("n1".into(), NotificationResponse::Click), Some("n1".into()));
        for response in [
            NotificationResponse::None,
            NotificationResponse::CloseButton("Close".into()),
            NotificationResponse::ActionButton("Other action".into()),
            NotificationResponse::Reply("Text".into()),
        ] {
            assert_eq!(activation_tag("n1".into(), response), None);
        }
    }

    #[test]
    fn clicking_an_earlier_banner_keeps_its_own_notice_tag() {
        assert_eq!(activation_tag("n2".into(), NotificationResponse::Click), Some("n2".into()));
        assert_eq!(activation_tag("n1".into(), NotificationResponse::Click), Some("n1".into()));
    }
}
