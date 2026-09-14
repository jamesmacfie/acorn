mod app_scheme;
mod commands;
mod crash;
mod helper;
mod keychain;
mod menu;
mod plugin_scheme;
mod webviews;

#[cfg(all(feature = "agent-automation", not(debug_assertions)))]
compile_error!(
    "agent-automation is a local debug feature and cannot be included in a release build"
);

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use app_scheme::{Source, APP_ORIGIN, APP_SCHEME};
use commands::Shell;
use helper::{Handshake, Helper, Launch, Legacy, Signal};
use plugin_scheme::{Frames, PLUGIN_SCHEME};
use webviews::Webviews;

// The Rust shell: the window, the app scheme, the menu and lifecycle, native dialogs, the OS keychain,
// and helper supervision. The helper process, the renderer bridge, and the node are TypeScript. See
// docs/shell.md.
//
// Boot waits for the helper and no further. `setup` blocks until the helper prints its ready line,
// which it does once it is listening, and the window opens on that. The node's own boot runs behind
// the window and arrives as a `node-status` push, so the shell draws its persisted cache instead of
// waiting a few hundred milliseconds for a node it will then re-read anyway
// (docs/performance.md § Every host draws first). What the window still cannot open
// without is the helper: the renderer's first question is which nodes there are, and the fleet is the
// helper's file.

/// The wire version both ends of the stdin handshake agree on.
const HELPER_PROTOCOL: u32 = 1;

/// A release build is a packaged one. It decides which roots the helper is pointed at, the
/// application data directory or the checkout, and nothing else.
const PACKAGED: bool = !cfg!(debug_assertions);

/// The Vite dev server to proxy the renderer from, when there is one. See src/app_scheme.rs for why
/// dev is proxied rather than loaded directly.
fn dev_server() -> Option<String> {
    std::env::var("ACORN_DEV_SERVER").ok().filter(|value| !value.is_empty())
}

pub fn run() {
    // Read once, at the top, because the window and the scheme handler both need it. A runtime
    // variable rather than a compile-time one, so a stale cargo cache cannot bake the wrong answer
    // into a binary.
    let dev_server = dev_server();
    // The helper's port, shared with the scheme handler. The handler is registered before the app
    // runs and the port is not known until the helper is up, so it is read per response. By the time
    // index.html is asked for, the window exists, which means the helper is ready.
    let helper_port = Arc::new(RwLock::new(0u16));

    let scheme_port = helper_port.clone();
    let scheme_dev = dev_server.clone();
    // Read before the app runs, because the scheme handler cannot ask for state it does not have.
    let frames: Arc<RwLock<Option<Frames>>> = Arc::new(RwLock::new(None));
    let scheme_frames = frames.clone();
    // The app scheme needs the same handle: a loaded plugin's tree worker is that plugin's bundle,
    // served from this origin because a worker script must be same-origin with the document that
    // starts it. See src/app_scheme.rs, `plugin_worker_hash`.
    let worker_frames = frames.clone();

    let mut builder = tauri::Builder::default();

    #[cfg(not(feature = "agent-automation"))]
    {
        // The data root's exclusive lock in the node is the real mutual exclusion. This makes a second
        // launch focus the running window instead of failing on that lock.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.webview_windows().values().next() {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    #[cfg(feature = "agent-automation")]
    {
        builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // The renderer never invokes this plugin's own commands — capabilities/default.json grants it
        // nothing — so it is here only to give src/commands.rs `app.notification()`.
        .plugin(tauri_plugin_notification::init())
        // Asynchronous, because the synchronous form runs the whole response on the thread that
        // delivered the request — the same thread the webview draws on — and a cold window asks for
        // more than a hundred module scripts. Each one was a blocking `fs::read` in front of the next
        // request, and under `pnpm dev` a blocking HTTP call to Vite. One thread per request answers
        // them in parallel instead. The ceiling is that it is a thread rather than a pool: fine for
        // the tens of reads a launch makes, and the upgrade if that ever changes is a small pool
        // behind the same responder.
        .register_asynchronous_uri_scheme_protocol(APP_SCHEME, move |ctx, request, responder| {
            let source = match &scheme_dev {
                Some(origin) => Source::DevServer(origin.clone()),
                None => Source::Files(client_root(ctx.app_handle())),
            };
            let frames = worker_frames.clone();
            let port = scheme_port.clone();
            std::thread::spawn(move || {
                responder.respond(app_scheme::serve(&source, frames.read().unwrap().as_ref(), *port.read().unwrap(), &request))
            });
        })
        // The origin every loaded plugin's UI runs on. Registered here rather than lazily, because a
        // privileged scheme has to exist before the webview that will ask for it does.
        .register_uri_scheme_protocol(PLUGIN_SCHEME, move |_ctx, request| match scheme_frames.read().unwrap().as_ref() {
            Some(frames) => plugin_scheme::serve(frames, &request),
            None => tauri::http::Response::builder().status(503).body(Vec::new()).expect("a bodyless response always builds"),
        })
        .invoke_handler(tauri::generate_handler![
            commands::helper_endpoint,
            commands::pick_folder,
            commands::pick_files,
            commands::save_file,
            commands::reveal_data_folder,
            commands::force_quit,
            commands::quit_approved,
            commands::show_notification,
            commands::set_badge,
            commands::set_window_background,
            webviews::webview_ensure,
            webviews::webview_bounds,
            webviews::webview_show,
            webviews::webview_hide,
            webviews::webview_hide_family,
            webviews::webview_load,
            webviews::webview_command,
            webviews::webview_evict,
        ])
        .menu(menu::build)
        .on_menu_event(|app, event| menu::on_menu_event(app.app_handle(), event.id().as_ref()))
        .setup(move |app| {
            let handle = app.handle().clone();
            app.manage(Webviews::<tauri::Wry>::default());
            // Deliberately blocking, and short: the helper reports itself ready as soon as it is
            // listening, which is a cache sweep and a socket bind rather than a node boot. There is
            // nothing for the event loop to do in the meantime, and a window opened before the
            // helper existed could not ask which nodes there are.
            match boot(&handle) {
                Ok((helper, plugin_frames)) => {
                    *helper_port.write().unwrap() = helper.ready.port;
                    *frames.write().unwrap() = Some(plugin_frames);
                    println!("[shell] helper ready on {} under Node {}", helper.ready.port, helper.ready.node_version);
                    if let Some(shell) = handle.try_state::<Shell>() {
                        *shell.helper.lock().unwrap() = Some(helper);
                    }
                    open_window(&handle)?;
                }
                Err(error) => {
                    // A helper that never became ready. Nothing can reach a node without it, so say
                    // why and quit rather than sit headless in the dock. A node that fails to start
                    // after this point is a different case: the window is already open, and the
                    // helper's crash budget puts the recovery dialog over the shell.
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
            // The quit negotiation's other entry point: the dock's Quit, or a Cmd-Q the menu missed.
            // `prevent_exit` holds the process while the renderer is asked.
            RunEvent::ExitRequested { api, .. } => {
                let approved = app.try_state::<Shell>().is_some_and(|s| s.quit_approved.load(Ordering::SeqCst));
                if !approved {
                    api.prevent_exit();
                    menu::request_quit(app);
                }
            }
            // The click on a system notification, as near as desktop Tauri gets to one
            // (src/commands.rs, `window_focused`).
            RunEvent::WindowEvent { label, event: tauri::WindowEvent::Focused(true), .. } if label == "main" => {
                commands::window_focused(app)
            }
            RunEvent::Exit => {
                // Before the helper, so no child webview is left composited over a window whose
                // process is on its way out.
                app.state::<Webviews<tauri::Wry>>().dispose();
                commands::shutdown(app)
            }
            _ => {}
        });
}

/// Where the built renderer lives in a packaged build, beside the other bundled resources. The scheme
/// handler is the only thing that reads it.
fn client_root(app: &tauri::AppHandle) -> PathBuf {
    app.path().resource_dir().map(|dir| dir.join("client")).unwrap_or_else(|_| PathBuf::from("client"))
}

/// Where the injected bridge and the plugin frames' stylesheet are staged. One directory, because
/// both are renderer-facing assets this shell builds rather than the node's.
fn bridge_dir(app: &tauri::AppHandle) -> PathBuf {
    if PACKAGED {
        app.path().resource_dir().map(|dir| dir.join("bridge")).unwrap_or_default()
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/bridge")
    }
}

/// Resolve the two roots, get or create the data key, then start and wait for the helper. The plugin
/// frame handler's inputs come back with it, because this is where both roots are known.
fn boot(app: &tauri::AppHandle) -> Result<(Helper, Frames), String> {
    let packaged = PACKAGED;
    let path = app.path();

    // The node's data root and the shell's custody root are separate on purpose: fleet.json and the
    // encrypted device tokens belong to this app, not the node. A dev build points both at the
    // checkout so a developer's fleet is not the installed app's.
    let (data_dir, user_data_dir) = if packaged {
        let base = path.app_data_dir().map_err(|e| format!("no application data directory: {e}"))?;
        (base.join("node"), base)
    } else {
        let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../node/.acorn");
        let checkout = development_data_root(
            checkout,
            std::env::var_os("ACORN_DATA_DIR").map(PathBuf::from),
        );
        (checkout.clone(), checkout.join("shell"))
    };
    for dir in [&data_dir, &user_data_dir] {
        std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }

    // The earliest point both roots exist, which is what the hook needs to know. A panic before this
    // is inside Tauri's own start-up, where there is no window, no helper and nothing to report to
    // (src/crash.rs).
    crash::install(&user_data_dir, app.package_info().version.to_string());

    let staging = if packaged { path.resource_dir().map_err(|e| e.to_string())?.join("helper") } else { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/helper") };
    let node = if packaged { bundled_node() } else { bundled_node_for_host() };
    for required in [&node, &staging.join("helper.js"), &staging.join("service.js")] {
        if !required.exists() {
            return Err(format!("{} is missing — run `pnpm run stage` in apps/desktop.", required.display()));
        }
    }

    let bundled_plugins = if packaged {
        path.resource_dir().map_err(|e| e.to_string())?.join("plugins")
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/bundled-plugins")
    };

    let frames = Frames::new(&user_data_dir, &bridge_dir(app).join("plugin-frame.css"));

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
                legacy: legacy_custody(&path, packaged),
                env_files: env_files(app, &data_dir, packaged)?,
                version: app.package_info().version.to_string(),
                is_packaged: packaged,
                app_origin: APP_ORIGIN.to_string(),
            },
        },
        move |signal| match signal {
            Signal::CrashBudgetExhausted { reason } => show_recovery(&handle, reason.as_deref()),
            // The credential for a preview tunnel, seeded into the pane's cookie store by
            // src/webviews.rs. Never forwarded to the renderer.
            Signal::TunnelOpened { port, secret } => handle.state::<Webviews<tauri::Wry>>().tunnel_opened(port, secret),
            Signal::TunnelClosed { port } => handle.state::<Webviews<tauri::Wry>>().tunnel_closed(port),
            Signal::Ready(_) => {}
        },
    )?;

    app.manage(Shell {
        helper: Mutex::new(None),
        data_dir,
        quit_approved: AtomicBool::new(false),
        quit_pending: AtomicBool::new(false),
    });
    Ok((helper, frames))
}

fn development_data_root(checkout: PathBuf, requested: Option<PathBuf>) -> PathBuf {
    requested
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(checkout)
}

/// The Electron build's custody root and the key its device tokens are encrypted under, when both are
/// there. The helper adopts them once, on a first launch that has nothing of its own. See
/// `packages/custody/src/custody/legacyCustody.ts` for what happens when that fails.
///
/// Packaged builds only. A dev build never asks the keychain (see src/keychain.rs), and its custody
/// root is the checkout, which no Electron build ever wrote to.
fn legacy_custody(path: &tauri::path::PathResolver<tauri::Wry>, packaged: bool) -> Option<Legacy> {
    if !packaged {
        return None;
    }
    // Electron's userData is `<app data>/<app name>`, and safeStorage names its keychain item after
    // the same app name. Tauri keys its app data directory by bundle identifier, which is why the two
    // builds do not share a root.
    const ELECTRON_APP_NAME: &str = "acorn";
    let user_data_dir = path.data_dir().ok()?.join(ELECTRON_APP_NAME);
    if !user_data_dir.join("fleet.json").exists() {
        return None;
    }
    Some(Legacy {
        user_data_dir: user_data_dir.to_string_lossy().into_owned(),
        safe_storage_key: keychain::legacy_safe_storage_key(ELECTRON_APP_NAME)?,
    })
}

/// Where the helper looks for secrets: the build's own file first, then the owner's file in the data
/// directory, which wins. See docs/shell.md, "Startup: data directory, environment, and the singleton
/// lock". A dev build reads the checkout's own `.env`, beside this crate.
fn env_files(app: &tauri::AppHandle, data_dir: &Path, packaged: bool) -> Result<Vec<String>, String> {
    let bundled = if packaged {
        app.path().resource_dir().map_err(|e| e.to_string())?.join(".env")
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env")
    };
    Ok([bundled, data_dir.join(".env")].iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

/// The bundled runtime in a packaged build. `externalBin` strips the target triple and stages the
/// binary beside this executable rather than under the other resources. On macOS that is
/// `Contents/MacOS`, which `resource_dir()` does not name. Getting it wrong is invisible until
/// somebody installs the app, which is what `scripts/verify-bundle.mjs` catches.
fn bundled_node() -> PathBuf {
    std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join("node"))).unwrap_or_else(|| PathBuf::from("node"))
}

/// The bundled runtime in a dev build, named the way `bundle.externalBin` names it, so dev and
/// packaged disagree about the path and nothing else.
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
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url));
    // A macOS title bar that paints the window background instead of the system chrome, so the strip
    // above the app is whichever colour the theme is. The web content stays below it, which is the
    // difference from `Overlay`: no drag region to define and no gap to leave for the traffic
    // lights. `commands::set_window_background` is the other half, because only the page knows the
    // colour. See docs/shell.md, "The renderer bridge".
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Transparent);
    builder
        .title("acorn")
        .inner_size(1440.0, 900.0)
        // The colour until the page reports its own, one paint later: the default theme's `--bg`
        // (client-core styles/tokens-theme.css). Wrong for any other theme, and only for that paint.
        .background_color(tauri::webview::Color(0x12, 0x12, 0x12, 0xff))
        // This is the preload. It runs before any page script, so the host global is installed before
        // the shell mounts and the platform string the seam reads synchronously is already there. A
        // `<script>` tag in the HTML could only approximate both.
        .initialization_script(bridge_script(app))
        // Main-frame navigation policy, plus the subframe guard: a plugin frame loads
        // `app-plugin://<hash>`, and nothing else does. GitHub connects by device flow against the
        // node, so nothing legitimate navigates this frame off its own origin. See docs/shell.md,
        // "The plugin frame origin".
        .on_navigation(|url| {
            if url.as_str().starts_with(APP_ORIGIN) || url.scheme() == PLUGIN_SCHEME {
                return true;
            }
            eprintln!("[shell] blocked navigation: {url}");
            false
        })
        .build()?;
    Ok(())
}

/// The renderer bridge, plus the one value it cannot ask for asynchronously. A missing bundle is not
/// fatal. The window still opens, the seam resolves no groups, and the renderer says it cannot reach
/// a node, which reads better than a black window.
fn bridge_script(app: &tauri::AppHandle) -> String {
    let path = bridge_dir(app).join("bridge.js");
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
/// render this is behind the gate it is about to show.
fn show_recovery(app: &tauri::AppHandle, reason: Option<&str>) {
    let Some(shell) = app.try_state::<Shell>() else { return };
    let data_dir = shell.data_dir.clone();
    // Whatever the service said about the last attempt. Most causes name their own fix, such as
    // another node holding this data root, a taken port, or a file the owner cannot read. The
    // messages go to stderr, so this dialog is the only place the owner sees them.
    let because = reason.map(|reason| format!("\n\nThe last attempt failed: {reason}")).unwrap_or_default();
    let answer = app
        .dialog()
        .message(format!(
            "It restarted five times in ten minutes, so acorn stopped trying. Your data is untouched — acorn never creates a fresh data root to recover.{because}\n\n{}",
            data_dir.display()
        ))
        .kind(MessageDialogKind::Error)
        .title("The acorn background service keeps stopping")
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom("Retry".into(), "Open data folder".into()))
        .blocking_show();
    if answer {
        // A retry is new information. The owner may have freed the port or fixed permissions, so the
        // helper forgives the spent budget and tries once more.
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
    let reason = reason.map(str::to_string);
    std::thread::spawn(move || show_recovery(&handle, reason.as_deref()));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The origin the window loads and the origin the helper checks on the WebSocket upgrade are one
    /// constant, not two spellings.
    #[test]
    fn the_window_url_is_the_origin_the_helper_checks() {
        assert!(format!("{APP_ORIGIN}/").starts_with(APP_ORIGIN));
        assert_eq!(APP_ORIGIN, "app://acorn");
    }

    #[test]
    fn a_development_data_root_can_be_isolated() {
        let checkout = PathBuf::from("checkout/.acorn");
        assert_eq!(development_data_root(checkout.clone(), None), checkout);
        assert_eq!(
            development_data_root(checkout.clone(), Some(PathBuf::new())),
            checkout
        );
        assert_eq!(
            development_data_root(checkout, Some(PathBuf::from("agent-data"))),
            PathBuf::from("agent-data")
        );
    }

    /// The one thing a JSON file can get wrong that nothing else would catch. Naming a window in a
    /// capability grants it to every webview in that window, and the main window hosts the preview
    /// pane and plugin webview surfaces, which are pages this app does not write.
    #[test]
    fn no_capability_is_granted_by_window() {
        let capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).expect("the capability file is JSON");
        assert!(capability.get("windows").is_none(), "capabilities must be scoped by webview label, not by window");
        assert_eq!(capability["webviews"], serde_json::json!(["main"]));
    }

    /// The three packaging properties that only show up when somebody installs the artifact. See
    /// docs/shell.md, "Build and packaging".
    ///
    /// Leave `signingIdentity` out and Tauri signs nothing: the `.app` carries only the linker's mark
    /// on one binary and seals no resources, and `codesign --verify` says so. Ad-hoc signing is the
    /// floor; a Developer ID replaces the string and notarization joins the same pass. Updater
    /// artifacts are signed from the first release even with no endpoint, so turning updates on later
    /// is configuration rather than a re-release.
    #[test]
    fn the_bundle_is_signed_and_its_updater_artifacts_are_too() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).expect("the bundle config is JSON");
        assert_eq!(config["bundle"]["macOS"]["signingIdentity"], serde_json::json!("-"), "the macOS bundle must be at least ad-hoc signed");
        assert_eq!(config["bundle"]["createUpdaterArtifacts"], serde_json::json!(true));
        let pubkey = config["plugins"]["updater"]["pubkey"].as_str().unwrap_or_default();
        assert!(!pubkey.is_empty(), "an updater artifact nothing can verify is worse than none");
    }

    #[test]
    fn the_platform_string_is_the_one_the_seam_expects() {
        // 'darwin' | 'win32' | 'linux', the values `hostPlatform()` documents.
        assert!(["darwin", "win32", "linux"].contains(&tauri_platform()) || cfg!(not(any(target_os = "macos", target_os = "windows", target_os = "linux"))));
    }
}
