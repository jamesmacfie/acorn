use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::helper::NodeStatus;

// Tray mode: with **Keep the Node running when the window closes** on, closing the window leaves the
// helper and the Node running behind this icon. The icon exists only while the setting is on, and is
// the reminder that the Node still runs. See docs/shell/process.md, "Tray mode".

const TRAY_ID: &str = "acorn";
const OPEN: &str = "tray:open";
const PAIR: &str = "tray:pair";
const QUIT: &str = "tray:quit";

/// The argument the login item launches with. It opens no window, so it only ever reaches a launch
/// while tray mode is on: turning either switch off removes the login item.
pub const HIDDEN_ARG: &str = "--hidden";

/// Where **Pair another client…** lands: the local Node's row in Settings → Nodes, which opens codes.
const PAIR_LINK: &str = "acorn://local/settings/nodes";

const STARTING: &str = "Node starting";

/// The status line, kept while there is no tray so a tray built later starts with the current text.
pub struct Tray {
    status: Mutex<String>,
    item: Mutex<Option<MenuItem<Wry>>>,
}

impl Default for Tray {
    fn default() -> Self {
        Self { status: Mutex::new(STARTING.into()), item: Mutex::new(None) }
    }
}

/// What the status line says for a status from the helper. An offline local Node is one the helper is
/// starting or restarting. A Node it gave up on arrives as a crash budget instead, through `stopped`.
pub fn status_text(status: &NodeStatus) -> String {
    match status.state.as_str() {
        "online" | "degraded" => match status.port {
            Some(port) if !status.hosts.is_empty() => {
                let addresses: Vec<String> = status.hosts.iter().map(|host| format!("{host}:{port}")).collect();
                format!("Node running, reachable at {}", addresses.join(", "))
            }
            _ => "Node running, this computer only".into(),
        },
        "offline" => STARTING.into(),
        other => format!("Node stopped: {other}"),
    }
}

/// The status line once the helper has stopped restarting the Node.
pub fn stopped_text(reason: Option<&str>) -> String {
    format!("Node stopped: {}", reason.unwrap_or("it kept stopping"))
}

pub fn set_status(app: &AppHandle, text: String) {
    let Some(tray) = app.try_state::<Tray>() else { return };
    if let Some(item) = tray.item.lock().unwrap().as_ref() {
        let _ = item.set_text(&text);
    }
    *tray.status.lock().unwrap() = text;
}

/// Show the icon while tray mode is on, and remove it when it goes off.
pub fn sync(app: &AppHandle, keep_node_running: bool) {
    let Some(tray) = app.try_state::<Tray>() else { return };
    let exists = app.tray_by_id(TRAY_ID).is_some();
    if keep_node_running && !exists {
        if let Err(error) = build(app, &tray) {
            eprintln!("[shell] could not show the tray icon: {error}");
        }
    } else if !keep_node_running && exists {
        app.remove_tray_by_id(TRAY_ID);
        *tray.item.lock().unwrap() = None;
    }
}

fn build(app: &AppHandle, tray: &Tray) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "tray:status", tray.status.lock().unwrap().as_str(), false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, OPEN, "Open acorn", true, None::<&str>)?,
            &MenuItem::with_id(app, PAIR, "Pair another client…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, QUIT, "Quit acorn", true, None::<&str>)?,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID).tooltip("acorn").menu(&menu).on_menu_event(|app, event| {
        match event.id().as_ref() {
            OPEN => crate::ensure_window(app),
            PAIR => crate::links::receive(app, PAIR_LINK.into()),
            QUIT => crate::menu::request_quit(app),
            _ => {}
        }
    });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    *tray.item.lock().unwrap() = Some(status);
    Ok(())
}

/// Register or remove the login item. It exists only while both switches are on.
pub fn sync_login_item(app: &AppHandle, wanted: bool, packaged: bool) {
    // A dev build would register its own debug binary to open at every login.
    if !packaged {
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let login = app.autolaunch();
    if login.is_enabled().unwrap_or(false) == wanted {
        return;
    }
    let result = if wanted { login.enable() } else { login.disable() };
    if let Err(error) = result {
        eprintln!("[shell] could not change whether acorn opens at login: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(state: &str, hosts: &[&str], port: Option<u16>) -> NodeStatus {
        NodeStatus { state: state.into(), hosts: hosts.iter().map(|host| host.to_string()).collect(), port }
    }

    #[test]
    fn the_status_line_names_the_addresses_another_machine_can_use() {
        assert_eq!(status_text(&status("online", &["192.168.1.20"], Some(4317))), "Node running, reachable at 192.168.1.20:4317");
        assert_eq!(
            status_text(&status("degraded", &["192.168.1.20", "box.local"], Some(4317))),
            "Node running, reachable at 192.168.1.20:4317, box.local:4317"
        );
        assert_eq!(status_text(&status("online", &[], Some(4317))), "Node running, this computer only");
        assert_eq!(status_text(&status("online", &["192.168.1.20"], None)), "Node running, this computer only");
        assert_eq!(status_text(&status("offline", &[], None)), "Node starting");
        assert_eq!(status_text(&status("incompatible", &[], None)), "Node stopped: incompatible");
        assert_eq!(stopped_text(Some("port 4317 is taken")), "Node stopped: port 4317 is taken");
        assert_eq!(stopped_text(None), "Node stopped: it kept stopping");
    }
}
