mod app_scheme;
mod commands;
mod helper;
mod keychain;
mod menu;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use app_scheme::{Source, APP_ORIGIN, APP_SCHEME};
use commands::Shell;
use helper::{Handshake, Helper, Launch, Signal};

// The Rust shell: the window, the app scheme, the menu and lifecycle, native dialogs, the OS keychain,
// and helper supervision. Everything else is TypeScript — the helper process, the renderer bridge, and
// the node (docs/future/tauri/architecture.md).
//
// Boot order matters and is the reverse of what a Tauri app usually does. The helper is started and
// waited for BEFORE the window exists, so the broker is warm by the time the renderer's first act — the
// fleet list — arrives. That is the guarantee Electron gives today, and the recovery screen is the only
// thing a renderer that booted first would have to show.

/// The wire version both ends of the stdin handshake agree on.
const HELPER_PROTOCOL: u32 = 1;

/// A release build is a packaged one. It decides which roots the helper is pointed at — the
/// application data directory, or the checkout — and nothing else.
const PACKAGED: bool = !cfg!(debug_assertions);

/// The Vite dev server to proxy the renderer from, when there is one (src/app_scheme.rs explains why
/// dev is proxied rather than loaded directly).
fn dev_server() -> Option<String> {
    std::env::var("ACORN_DEV_SERVER").ok().filter(|value| !value.is_empty())
}

pub fn run() {
    // Read once, at the top, because the window and the scheme handler both need it and neither should
    // be deciding what "dev" means. A runtime variable rather than a compile-time one: `pnpm dev:tauri`
    // sets it, and a stale cargo cache must not be able to bake the wrong answer into a binary.
    let dev_server = dev_server();
    // The helper's port, shared with the scheme handler. The handler has to be registered before the
    // app runs, and the port is not known until the helper is up, so it is read per response rather
    // than baked in at registration. By the time index.html is asked for, the window exists, which
    // means the helper is ready.
    let helper_port = Arc::new(RwLock::new(0u16));

    let scheme_port = helper_port.clone();
    let scheme_dev = dev_server.clone();

    tauri::Builder::default()
        // The data root's exclusive lock in the node is the real mutual exclusion; this is what makes a
        // second launch focus the running window instead of failing on that lock.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.webview_windows().values().next() {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol(APP_SCHEME, move |ctx, request| {
            let source = match &scheme_dev {
                Some(origin) => Source::DevServer(origin.clone()),
                None => Source::Files(client_root(ctx.app_handle())),
            };
            app_scheme::serve(&source, *scheme_port.read().unwrap(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            commands::helper_endpoint,
            commands::pick_folder,
            commands::reveal_data_folder,
            commands::force_quit,
            commands::quit_approved,
        ])
        .menu(menu::build)
        .on_menu_event(|app, event| menu::on_menu_event(app.app_handle(), event.id().as_ref()))
        .setup(move |app| {
            let handle = app.handle().clone();
            // Deliberately blocking: there is nothing for the event loop to do until the node is up,
            // and the alternative is a window that renders the recovery screen for a second every
            // launch. Electron's `await bootstrap()` is the same shape.
            match boot(&handle) {
                Ok(helper) => {
                    *helper_port.write().unwrap() = helper.ready.port;
                    println!("[shell] helper ready on {} under Node {}", helper.ready.port, helper.ready.node_version);
                    if let Some(shell) = handle.try_state::<Shell>() {
                        *shell.helper.lock().unwrap() = Some(helper);
                    }
                    open_window(&handle)?;
                }
                Err(error) => {
                    // Boot is all-or-nothing. A failure here means there is no node to talk to, so this
                    // says why and quits rather than sitting headless in the dock.
                    handle
                        .dialog()
                        .message(&error)
                        .kind(MessageDialogKind::Error)
                        .title("acorn failed to start")
                        .blocking_show();
                    handle.exit(1);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the acorn shell failed to build")
        .run(|app, event| match event {
            // The quit negotiation's other entry point: the dock's Quit, or a Cmd-Q the menu did not
            // catch. `prevent_exit` holds the process while the renderer is asked.
            RunEvent::ExitRequested { api, .. } => {
                let approved = app.try_state::<Shell>().is_some_and(|s| s.quit_approved.load(Ordering::SeqCst));
                if !approved {
                    api.prevent_exit();
                    menu::request_quit(app);
                }
            }
            RunEvent::Exit => commands::shutdown(app),
            _ => {}
        });
}

/// Where the built renderer lives in a packaged build. Beside the other bundled resources, because the
/// scheme handler is the only thing that reads it and it is never a path anything else supplies.
fn client_root(app: &tauri::AppHandle) -> PathBuf {
    app.path().resource_dir().map(|dir| dir.join("client")).unwrap_or_else(|_| PathBuf::from("client"))
}

/// Resolve the two roots, get or create the data key, then start and wait for the helper.
fn boot(app: &tauri::AppHandle) -> Result<Helper, String> {
    let packaged = PACKAGED;
    let path = app.path();

    // The node's data root and the shell's custody root are two different directories on purpose:
    // fleet.json and the encrypted device tokens are this app's, not the node's. A dev build points
    // both at the checkout so a developer's fleet is not the installed app's.
    let (data_dir, user_data_dir) = if packaged {
        let base = path.app_data_dir().map_err(|e| format!("no application data directory: {e}"))?;
        (base.join("node"), base)
    } else {
        let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../node/.acorn");
        (checkout.clone(), checkout.join("shell"))
    };
    for dir in [&data_dir, &user_data_dir] {
        std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }

    let staging = if packaged { path.resource_dir().map_err(|e| e.to_string())?.join("helper") } else { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/helper") };
    let node = if packaged {
        // `externalBin` strips the target triple when it stages the binary into the bundle.
        path.resource_dir().map_err(|e| e.to_string())?.join("node")
    } else {
        bundled_node_for_host()
    };
    for required in [&node, &staging.join("helper.js"), &staging.join("service.js")] {
        if !required.exists() {
            return Err(format!("{} is missing — run `pnpm run stage` in apps/desktop-tauri.", required.display()));
        }
    }

    let bundled_plugins = if packaged {
        path.resource_dir().map_err(|e| e.to_string())?.join("plugins")
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/bundled-plugins")
    };

    let handle = app.clone();
    let helper = Helper::start(
        Launch {
            node,
            entry: staging.join("helper.js"),
            handshake: Handshake {
                protocol: HELPER_PROTOCOL,
                data_key: keychain::data_key(&user_data_dir, packaged),
                data_dir: data_dir.to_string_lossy().into_owned(),
                user_data_dir: user_data_dir.to_string_lossy().into_owned(),
                service_entry: staging.join("service.js").to_string_lossy().into_owned(),
                mcp_entry: staging.join("mcp.js").to_string_lossy().into_owned(),
                bundled_plugins_dir: bundled_plugins.exists().then(|| bundled_plugins.to_string_lossy().into_owned()),
                env_files: env_files(app, &data_dir, packaged)?,
                version: app.package_info().version.to_string(),
                is_packaged: packaged,
                app_origin: APP_ORIGIN.to_string(),
            },
        },
        move |signal| {
            if matches!(signal, Signal::CrashBudgetExhausted) {
                show_recovery(&handle);
            }
        },
    )?;

    app.manage(Shell {
        helper: Mutex::new(None),
        data_dir,
        quit_approved: AtomicBool::new(false),
        quit_pending: AtomicBool::new(false),
    });
    Ok(helper)
}

/// Where the helper looks for secrets, in the order Electron reads them: the build's own file first,
/// then the owner's file in the data directory, which wins (docs/electron.md § Startup: data
/// directory, environment, and the singleton lock).
///
/// A dev build reads apps/desktop/.env, because that is where a developer's file already is and two
/// shells against one checkout should not mean two copies of the same secrets. That path goes at
/// cutover with the package it names.
fn env_files(app: &tauri::AppHandle, data_dir: &Path, packaged: bool) -> Result<Vec<String>, String> {
    let bundled = if packaged {
        app.path().resource_dir().map_err(|e| e.to_string())?.join(".env")
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../desktop/.env")
    };
    Ok([bundled, data_dir.join(".env")].iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

/// The bundled runtime in a dev build, named the way `bundle.externalBin` names it so dev and packaged
/// disagree about the path and nothing else.
fn bundled_node_for_host() -> PathBuf {
    let triple = std::env::var("ACORN_TARGET_TRIPLE").unwrap_or_else(|_| format!("{}-{}", std::env::consts::ARCH, host_suffix()));
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("node-{triple}"))
}

fn host_suffix() -> &'static str {
    match std::env::consts::OS {
        "macos" => "apple-darwin",
        "windows" => "pc-windows-msvc",
        _ => "unknown-linux-gnu",
    }
}

fn open_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let url = format!("{APP_ORIGIN}/").parse().expect("the app origin is a valid url");
    WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url))
        .title("acorn")
        .inner_size(1440.0, 900.0)
        .background_color(tauri::webview::Color(0x12, 0x12, 0x12, 0xff))
        // This is the preload. It runs before any page script, so the host global is installed before
        // the shell mounts and the platform string the seam reads synchronously is already there —
        // both of which a `<script>` tag in the HTML could only approximate.
        .initialization_script(bridge_script(app))
        // Main-frame navigation policy, and why there is no OAuth exception: docs/electron.md § The
        // plugin frame origin. GitHub connects by device flow against the node, so nothing legitimate
        // ever navigates this frame off its own origin.
        .on_navigation(|url| {
            if url.as_str().starts_with(APP_ORIGIN) {
                return true;
            }
            eprintln!("[shell] blocked navigation: {url}");
            false
        })
        .build()?;
    Ok(())
}

/// The renderer bridge, plus the one value it cannot ask for asynchronously. A missing bundle is not
/// fatal here: the window still opens, the seam resolves no groups, and the renderer says it cannot
/// reach a node — which is a far more legible failure than a black window.
fn bridge_script(app: &tauri::AppHandle) -> String {
    let path = if PACKAGED {
        app.path().resource_dir().map(|dir| dir.join("bridge/bridge.js")).unwrap_or_default()
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/bridge/bridge.js")
    };
    let bridge = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        eprintln!("[shell] could not read the renderer bridge at {}: {error}", path.display());
        String::new()
    });
    format!("globalThis.__ACORN_PLATFORM__ = {:?};\n{bridge}", tauri_platform())
}

fn tauri_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

/// The crash budget is spent and the helper has stopped trying. Native, because the shell that would
/// render this is behind the very gate it is about to show.
fn show_recovery(app: &tauri::AppHandle) {
    let Some(shell) = app.try_state::<Shell>() else { return };
    let data_dir = shell.data_dir.clone();
    let answer = app
        .dialog()
        .message(format!(
            "It restarted five times in ten minutes, so acorn stopped trying. Your data is untouched — acorn never creates a fresh data root to recover.\n\n{}",
            data_dir.display()
        ))
        .kind(MessageDialogKind::Error)
        .title("The acorn background service keeps stopping")
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom("Retry".into(), "Open data folder".into()))
        .blocking_show();
    if answer {
        // The owner asking for a retry is new information: they may have just freed the port or fixed
        // permissions, so the helper forgives the spent budget and tries once more.
        if let Ok(held) = shell.helper.lock() {
            if let Some(helper) = held.as_ref() {
                helper.command("retry");
            }
        }
        return;
    }
    // A look-at-it action, not an answer to "what should acorn do now", so it asks again afterwards.
    let _ = tauri_plugin_opener::reveal_item_in_dir(&data_dir);
    let handle = app.clone();
    std::thread::spawn(move || show_recovery(&handle));
}

/// Kept honest by the same rule Electron's is: the origin the window loads and the origin the helper
/// checks on the WebSocket upgrade are one constant, not two spellings.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_url_is_the_origin_the_helper_checks() {
        assert!(format!("{APP_ORIGIN}/").starts_with(APP_ORIGIN));
        assert_eq!(APP_ORIGIN, "app://acorn");
    }

    #[test]
    fn the_platform_string_is_the_one_the_seam_expects() {
        // 'darwin' | 'win32' | 'linux', the values `hostPlatform()` documents.
        assert!(["darwin", "win32", "linux"].contains(&tauri_platform()) || cfg!(not(any(target_os = "macos", target_os = "windows", target_os = "linux"))));
    }
}
