use std::sync::atomic::Ordering;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::commands::Shell;

// The application menu, and the two accelerators that are really product behaviour rather than
// decoration (docs/shell.md § Startup: data directory, environment, and the singleton lock).
//
// Quit is a custom item, never `PredefinedMenuItem::quit`, which routes through `[NSApp terminate:]`
// and bypasses the event loop — the quit negotiation would never run.
//
// Cmd/Ctrl+W closes the focused pane, never the window. Electron intercepts the key with
// `before-input-event`; there is no Tauri equivalent, so it is a menu item whose accelerator wins over
// the page and whose click becomes the same event the seam already listens for.
//
// The rest of the menu is the standard macOS set, spelled out rather than inherited: a window with no
// Edit menu has no working Cmd+C, and the default menu is not available once a custom one is set.

pub const CLOSE_PANE: &str = "acorn:close-pane";
pub const QUIT: &str = "acorn:quit";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let close_pane = MenuItem::with_id(app, CLOSE_PANE, "Close Pane", true, Some("CmdOrCtrl+W"))?;
    let quit = MenuItem::with_id(app, QUIT, "Quit acorn", true, Some("CmdOrCtrl+Q"))?;

    let application = Submenu::with_items(
        app,
        "acorn",
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(AboutMetadata::default()))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let file = Submenu::with_items(app, "File", true, &[&close_pane])?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    Menu::with_items(app, &[&application, &file, &edit, &window])
}

/// Menu clicks that are product behaviour. Everything else is a predefined item the platform handles.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        // The pane that owns focus decides what closes. If none does, nothing closes: this is a
        // single-window app and Cmd-Q is what quits it.
        CLOSE_PANE => {
            let _ = app.emit("acorn:close-pane", ());
        }
        QUIT => request_quit(app),
        _ => {}
    }
}

/// Ask the renderer before quitting, once. It collects concerns — a running agent, an unsaved buffer —
/// and answers through the `quit_approved` command, which is what actually exits.
pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    let Some(shell) = app.try_state::<Shell>() else { return };
    if shell.quit_approved.load(Ordering::SeqCst) {
        return;
    }
    // A second Cmd-Q while a prompt is out must not stack another one.
    if shell.quit_pending.swap(true, Ordering::SeqCst) {
        return;
    }
    // No renderer to ask means nothing to lose by quitting.
    if app.webview_windows().is_empty() || app.emit("acorn:will-quit", ()).is_err() {
        shell.quit_approved.store(true, Ordering::SeqCst);
        shell.quit_pending.store(false, Ordering::SeqCst);
        app.exit(0);
    }
}
