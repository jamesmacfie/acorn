use std::sync::atomic::Ordering;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::commands::Shell;

// The application menu, and the accelerators that are product behaviour rather than decoration.
//
// Quit is a custom item, never `PredefinedMenuItem::quit`, which routes through `[NSApp terminate:]`
// and bypasses the event loop, so the quit negotiation would never run.
//
// Cmd/Ctrl+W closes the focused pane, never the window. Cmd/Ctrl+K opens the command palette even
// while a child preview webview owns focus. Tauri has no key interception hook, so both are menu
// items whose accelerators win over the page and whose clicks become events the seam listens for.
//
// The rest is the standard macOS set, spelled out rather than inherited. A window with no Edit menu
// has no working Cmd+C, and the default menu is gone once a custom one is set.

pub const CLOSE_PANE: &str = "acorn:close-pane";
pub const COMMAND_PALETTE: &str = "acorn:command-palette";
pub const QUIT: &str = "acorn:quit";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let close_pane = MenuItem::with_id(app, CLOSE_PANE, "Close Pane", true, Some("CmdOrCtrl+W"))?;
    let command_palette = MenuItem::with_id(app, COMMAND_PALETTE, "Command Palette", true, Some("CmdOrCtrl+K"))?;
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

    let view = Submenu::with_items(app, "View", true, &[&command_palette])?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    Menu::with_items(app, &[&application, &file, &edit, &view, &window])
}

/// Menu clicks that are product behaviour. Everything else is a predefined item the platform handles.
pub fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        // The pane that owns focus decides what closes. If none does, nothing closes. This is a
        // single-window app, and Cmd-Q is what quits it.
        CLOSE_PANE => {
            let _ = app.emit("acorn:close-pane", ());
        }
        COMMAND_PALETTE => {
            let _ = app.emit("acorn:command-palette", ());
        }
        QUIT => request_quit(app),
        _ => {}
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum OnExit {
    Exit,
    /// Tray mode: the window closed, and the helper and the Node keep running.
    KeepRunning,
    /// Hold the exit and ask the renderer.
    AskRenderer,
}

/// What a `RunEvent::ExitRequested` does. Tauri sends no exit code when the last window closed, and a
/// code when something called `exit`. The macOS dock's Quit never arrives here: it terminates the
/// app without asking the event loop.
pub fn on_exit_requested(keep_node_running: bool, code: Option<i32>, quit_approved: bool) -> OnExit {
    match (quit_approved, code) {
        (true, _) => OnExit::Exit,
        (false, None) if keep_node_running => OnExit::KeepRunning,
        // The person closed the last window, so they asked to quit. The renderer that could have
        // asked them anything has already gone.
        (false, None) => OnExit::Exit,
        (false, Some(_)) => OnExit::AskRenderer,
    }
}

/// Ask the renderer before quitting, once. It collects concerns, such as a running agent or an
/// unsaved buffer, and answers through the `quit_approved` command, which is what exits.
pub fn request_quit(app: &AppHandle) {
    let Some(shell) = app.try_state::<Shell>() else { return };
    if shell.quit_approved.load(Ordering::SeqCst) {
        return;
    }
    // A second Cmd-Q while a prompt is out must not stack another one.
    if shell.quit_pending.swap(true, Ordering::SeqCst) {
        return;
    }
    // In tray mode the window can be closed while agents run, and only a renderer can name them. The
    // new renderer asks once its quit listener exists, through `take_pending_quit`.
    if app.get_webview_window("main").is_none() {
        shell.quit_after_reopen.store(true, Ordering::SeqCst);
        crate::ensure_window(app);
        return;
    }
    // The prompt shows in the window, so bring it forward.
    crate::ensure_window(app);
    if app.emit("acorn:will-quit", ()).is_err() {
        shell.approve_quit(app);
    }
}

#[cfg(test)]
mod tests {
    use super::{on_exit_requested, OnExit};

    #[test]
    fn closing_the_window_quits_unless_tray_mode_keeps_the_node_running() {
        for keep in [false, true] {
            // An approved quit always goes through, and an unapproved `exit` always asks.
            assert_eq!(on_exit_requested(keep, None, true), OnExit::Exit);
            assert_eq!(on_exit_requested(keep, Some(0), true), OnExit::Exit);
            assert_eq!(on_exit_requested(keep, Some(0), false), OnExit::AskRenderer);
            assert_eq!(on_exit_requested(keep, Some(1), false), OnExit::AskRenderer);
        }
        assert_eq!(on_exit_requested(false, None, false), OnExit::Exit);
        assert_eq!(on_exit_requested(true, None, false), OnExit::KeepRunning);
    }
}
