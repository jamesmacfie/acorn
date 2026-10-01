use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::{NotificationExt, PermissionState};

use crate::helper::Helper;

// The commands the renderer may call, and the shell state they read. This is the whole Tauri-side
// surface. Everything else goes over the helper socket. See docs/shell.md, "The shell process".

pub struct Shell {
    pub helper: Mutex<Option<Helper>>,
    pub data_dir: PathBuf,
    pub user_data_dir: PathBuf,
    /// The renderer has answered the will-quit prompt, or something has decided not to ask.
    pub quit_approved: AtomicBool,
    /// A prompt is out with the renderer. Guards against a second Cmd-Q stacking another one.
    pub quit_pending: AtomicBool,
}

impl Shell {
    pub fn approve_quit(&self, app: &AppHandle) {
        self.quit_approved.store(true, Ordering::SeqCst);
        self.quit_pending.store(false, Ordering::SeqCst);
        app.exit(0);
    }
}

#[derive(Serialize)]
pub struct Endpoint {
    port: u16,
    secret: String,
}

/// Where the helper is listening and the secret that opens it. The only way the renderer learns
/// either, which keeps the loopback listener closed to every other process on the machine.
#[tauri::command]
pub fn helper_endpoint(shell: State<'_, Shell>) -> Result<Endpoint, String> {
    let held = shell.helper.lock().map_err(|_| "the shell state is poisoned")?;
    let helper = held.as_ref().ok_or("the desktop helper is not running")?;
    Ok(Endpoint { port: helper.ready.port, secret: helper.ready.secret.clone() })
}

/// The native folder dialog, for onboarding and project mapping. Returns the chosen absolute path or
/// null. A caller that cannot open a dialog and one whose dialog was dismissed take the same path.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()));
    });
    // The picker answers on another thread, and this command is already off the main one.
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(None)).await.unwrap_or(None)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    name: String,
    #[serde(rename = "type")]
    mime: String,
    /// Base64. A `Vec<u8>` through Tauri's JSON channel arrives in the renderer as an array of
    /// numbers, which is the wrong shape and several times the size.
    bytes: String,
}

/// The native file dialog, for agent attachments. Returns the chosen files' bytes rather than their
/// paths, because the node this renderer talks to is not always on this machine and a path would
/// name something it cannot open. `accept` is bare extensions; an empty list means any file.
///
/// A file that cannot be read is dropped rather than failing the whole pick: the owner chose several
/// and the ones that worked are still worth attaching.
#[tauri::command]
pub async fn pick_files(app: AppHandle, accept: Vec<String>) -> Vec<PickedFile> {
    let mut dialog = app.dialog().file();
    if !accept.is_empty() {
        let extensions: Vec<&str> = accept.iter().map(String::as_str).collect();
        dialog = dialog.add_filter("Supported files", &extensions);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    dialog.pick_files(move |paths| {
        let _ = tx.send(paths.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).collect::<Vec<_>>());
    });
    // The picker answers on another thread, and this command is already off the main one.
    let paths = tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or_default()).await.unwrap_or_default();
    paths
        .into_iter()
        .filter_map(|path| {
            let bytes = std::fs::read(&path).ok()?;
            Some(PickedFile {
                name: path.file_name()?.to_string_lossy().into_owned(),
                mime: mime_for(&path).to_string(),
                bytes: BASE64.encode(bytes),
            })
        })
        .collect()
}

/// Enough of a guess for the harnesses that branch on it. The node re-derives what it needs from the
/// bytes; this only has to distinguish an image or a PDF from text.
fn mime_for(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "md" => "text/markdown",
        "html" => "text/html",
        "csv" => "text/csv",
        _ => "text/plain",
    }
}

/// The native save dialog plus the write. False when the owner dismissed the dialog and when the
/// write failed; either way the renderer learns nothing about where the file went, which keeps the
/// filesystem the shell's the same way `pick_folder` does.
const MAX_SAVE_BYTES: usize = 64 * 1024 * 1024;
const MAX_SAVE_ENCODED_CHARS: usize = MAX_SAVE_BYTES.div_ceil(3) * 4;

fn safe_suggested_name(value: &str) -> String {
    let clean = value.chars().take(180).fold(String::new(), |mut out, ch| {
        if ch.is_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            out.push(ch);
        } else if !out.ends_with('-') {
            out.push('-');
        }
        out
    });
    let clean = clean.trim_matches(|ch| matches!(ch, '.' | '-' | '_'));
    if clean.is_empty() { "download".to_string() } else { clean.to_string() }
}

#[tauri::command]
pub async fn save_file(app: AppHandle, bytes: String, suggested_name: String) -> bool {
    if bytes.len() > MAX_SAVE_ENCODED_CHARS { return false; }
    let Ok(decoded) = BASE64.decode(bytes) else { return false };
    if decoded.len() > MAX_SAVE_BYTES { return false; }
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_file_name(safe_suggested_name(&suggested_name)).save_file(move |path| {
        let _ = tx.send(path.and_then(|p| p.into_path().ok()));
    });
    let Some(path) = tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(None)).await.unwrap_or(None) else {
        return false;
    };
    std::fs::write(path, decoded).is_ok()
}

// ── Notifications and the dock badge ──────────────────────────────────────────────────────────
//
// Both are the shell's rather than the helper's: a banner and an app icon belong to the window's
// process. See docs/notifications.md for the gate upstream of them, which decides what
// is worth one.

/// Submit a banner. False when permission or submission fails. `tag` is the notice id,
/// handed back only on a native click so the renderer can find the exact notice.
///
/// No sound is ever asked for. The chime is the client's, and it plays whether or not the OS agreed
/// to draw a banner, so asking for both is how you get two sounds for one event.
#[tauri::command]
pub fn show_notification(app: AppHandle, title: String, body: Option<String>, tag: String) -> bool {
    let notification = app.notification();
    let granted = matches!(notification.permission_state(), Ok(PermissionState::Granted))
        || matches!(notification.request_permission(), Ok(PermissionState::Granted));
    if !granted {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        crate::notifications::show(app, title, body, tag)
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Tauri supplies no desktop activation callback here. A focus event cannot identify
        // a click or its notice, so these hosts show banners without inventing navigation.
        let _ = tag;
        let mut builder = notification.builder().title(title);
        if let Some(body) = body {
            builder = builder.body(body);
        }
        builder.show().is_ok()
    }
}

/// The number on the app icon, or none. Safe everywhere: Windows draws no badge from this call and
/// the seam does not promise one, only that asking is harmless.
#[tauri::command]
pub fn set_badge(app: AppHandle, count: Option<i64>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_badge_count(count);
    }
}

/// What to paint behind the transparent macOS title bar (`open_window` in lib.rs), so that strip
/// follows the theme. The page sends the colour because the theme is a CSS custom property nothing
/// on this side can read, and the bridge repaints on every theme change. Ignoring the result is
/// deliberate: `set_background_color` also touches the webview layer, which macOS does not
/// implement, and the window layer is the one that matters here.
#[tauri::command]
pub fn set_window_background(app: AppHandle, red: u8, green: u8, blue: u8) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_background_color(Some(tauri::webview::Color(red, green, blue, 0xff)));
    }
}

/// The recovery screen's "Open data folder". Reveals rather than opens, so the owner can look at a
/// wedged node without the shell deciding what to do about it.
#[tauri::command]
pub fn reveal_data_folder(shell: State<'_, Shell>) {
    if tauri_plugin_opener::reveal_item_in_dir(&shell.data_dir).is_err() {
        // Reveal is the nicer answer, but a file manager that cannot do it should still get the owner
        // to their data.
        let _ = tauri_plugin_opener::open_path(shell.data_dir.to_string_lossy().to_string(), None::<&str>);
    }
}

#[tauri::command]
pub fn open_config_file(shell: State<'_, Shell>) -> Result<(), String> {
    let path = shell.user_data_dir.join("acorn.json");
    if !path.exists() {
        std::fs::write(&path, "{}\n").map_err(|error| error.to_string())?;
    }
    tauri_plugin_opener::open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

/// The recovery screen's Quit. Skips the will-quit round trip, because it is reachable only when
/// there is no node to talk to and the shell that would answer the prompt is not mounted.
#[tauri::command]
pub fn force_quit(app: AppHandle, shell: State<'_, Shell>) {
    shell.approve_quit(&app);
}

/// The renderer's answer to the will-quit prompt. `false` means an agent or an unsaved buffer said
/// no, and the quit is abandoned. The owner is looking at the reason.
#[tauri::command]
pub fn quit_approved(app: AppHandle, shell: State<'_, Shell>, approved: bool) {
    shell.quit_pending.store(false, Ordering::SeqCst);
    if approved {
        shell.approve_quit(&app);
    }
}

/// Stop the helper, once, on the way out. Called from the exit path rather than `Drop`, because a
/// process that is about to exit does not reliably run destructors.
pub fn shutdown(app: &AppHandle) {
    if let Some(shell) = app.try_state::<Shell>() {
        if let Ok(mut held) = shell.helper.lock() {
            if let Some(helper) = held.take() {
                helper.stop();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{mime_for, safe_suggested_name, MAX_SAVE_BYTES, MAX_SAVE_ENCODED_CHARS};
    use std::path::Path;

    #[test]
    fn a_picked_file_gets_a_media_type_from_its_extension() {
        assert_eq!(mime_for(Path::new("/tmp/shot.PNG")), "image/png");
        assert_eq!(mime_for(Path::new("/tmp/scan.jpeg")), "image/jpeg");
        assert_eq!(mime_for(Path::new("/tmp/report.pdf")), "application/pdf");
        // Everything the harnesses read as text, including the extensions with no entry of their own
        // and a file with no extension at all.
        assert_eq!(mime_for(Path::new("/tmp/main.rs")), "text/plain");
        assert_eq!(mime_for(Path::new("/tmp/Makefile")), "text/plain");
    }

    #[test]
    fn a_node_supplied_download_name_cannot_preselect_a_path_or_hide_a_file() {
        assert_eq!(safe_suggested_name("../../.ssh/authorized_keys"), "ssh-authorized_keys");
        assert_eq!(safe_suggested_name("C:\\Users\\owner\\run\u{202e}cod.exe"), "C-Users-owner-run-cod.exe");
        assert_eq!(safe_suggested_name("\u{0000}../.."), "download");
        assert_eq!(safe_suggested_name("résumé.pdf"), "résumé.pdf");
        assert_eq!(MAX_SAVE_ENCODED_CHARS, MAX_SAVE_BYTES.div_ceil(3) * 4);
    }
}
