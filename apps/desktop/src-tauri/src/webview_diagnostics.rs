// Agent-automation only: process attribution for preview acceptance, outside consented telemetry.
// The response contains handle identity and measured process memory, never page content or URLs.
use serde::Serialize;
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    key: String,
    process_id: Option<i32>,
    physical_footprint: Option<u64>,
}

#[tauri::command]
pub async fn webview_diagnostics(app: AppHandle) -> Vec<Diagnostic> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        for (key, webview) in app.webviews() {
            let sender = sender.clone();
            let _ = webview.with_webview(move |platform| {
                let process_id = crate::footprint::web_content_pid(platform.inner());
                let physical_footprint = process_id.and_then(crate::footprint::phys_footprint);
                let _ = sender.send(Diagnostic { key, process_id, physical_footprint });
            });
        }
        drop(sender);
        tauri::async_runtime::spawn_blocking(move || {
            let mut result = Vec::new();
            while let Ok(diagnostic) = receiver.recv_timeout(std::time::Duration::from_secs(2)) {
                result.push(diagnostic);
            }
            result
        }).await.unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Vec::new()
    }
}

/// Wait outside the renderer so its background timer scheduling does not stall the hidden-page trial.
#[tauri::command]
pub async fn webview_trial_delay(milliseconds: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(milliseconds.min(600_000)));
    }).await;
}
