use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::helper::Helper;

// The commands the renderer may call, and the shell state they read. This is the whole Tauri-side
// surface: everything else the renderer needs goes over the helper socket
// (docs/future/tauri/architecture.md § The resulting Rust surface).

pub struct Shell {
    pub helper: Mutex<Option<Helper>>,
    pub data_dir: PathBuf,
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

/// Where the helper is listening and the secret that opens it. The one way the renderer learns either,
/// which is what keeps the loopback listener closed to every other process on the machine.
#[tauri::command]
pub fn helper_endpoint(shell: State<'_, Shell>) -> Result<Endpoint, String> {
    let held = shell.helper.lock().map_err(|_| "the shell state is poisoned")?;
    let helper = held.as_ref().ok_or("the desktop helper is not running")?;
    Ok(Endpoint { port: helper.ready.port, secret: helper.ready.secret.clone() })
}

/// The native folder dialog, for onboarding and project mapping. Returns the chosen absolute path or
/// null — a caller that cannot open a dialog and one whose dialog was dismissed take the same path.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()));
    });
    // The picker answers on another thread, and this command is already off the main one.
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(None)).await.unwrap_or(None)
}

/// The recovery screen's "Open data folder". Reveals rather than opens anything, so a wedged node is
/// something the owner can look at without the shell deciding what to do about it.
#[tauri::command]
pub fn reveal_data_folder(shell: State<'_, Shell>) {
    if tauri_plugin_opener::reveal_item_in_dir(&shell.data_dir).is_err() {
        // Reveal is the nicer answer and the one Electron gives, but a file manager that cannot do it
        // should still get the owner to their data rather than nothing at all.
        let _ = tauri_plugin_opener::open_path(shell.data_dir.to_string_lossy().to_string(), None::<&str>);
    }
}

/// The recovery screen's Quit. Skips the will-quit round trip on purpose: it is reachable exactly when
/// there is no node to talk to, and the shell that would answer the prompt is not mounted behind the
/// gate.
#[tauri::command]
pub fn force_quit(app: AppHandle, shell: State<'_, Shell>) {
    shell.approve_quit(&app);
}

/// The renderer's answer to the will-quit prompt. `false` means an agent or an unsaved buffer said no,
/// and the quit is simply abandoned — the owner will be looking at the reason.
#[tauri::command]
pub fn quit_approved(app: AppHandle, shell: State<'_, Shell>, approved: bool) {
    shell.quit_pending.store(false, Ordering::SeqCst);
    if approved {
        shell.approve_quit(&app);
    }
}

/// Stop the helper, once, on the way out. Called from the exit path rather than from `Drop`, because a
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
