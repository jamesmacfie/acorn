use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{Cookie, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Url, Webview, WebviewUrl};

// Host-owned child webviews: the browser preview pane and loaded-plugin webview surfaces. This is the
// Tauri answer to `apps/desktop/src/app/main/webviewService.ts` plus the two IPC files that drive it,
// and it is one module rather than three because the difference between the two products is a policy
// function and a key prefix (docs/future/tauri/webviews-and-frames.md).
//
// wry has no `WebContentsView` and no `webRequest`, so two things are shaped differently from Electron
// and both were measured in phase 0:
//
// A child webview under `Window::add_child` composites over the main one, takes logical bounds the
// renderer's pane geometry drives directly, and hides under overlays. `incognito(true)` gives it its
// own ephemeral data store, which is what `partition:`-without-`persist:` buys under Electron.
//
// Tunnel auth moves from a request header to a cookie. There is no `onBeforeSendHeaders` to inject
// `x-acorn-tunnel` per request, so the pane's cookie store is seeded before its first real navigation
// instead. The helper pushes each listener's secret to the shell as it opens one, keyed by port, and
// `previewTunnel.ts` accepts either spelling of the credential. The secret never reaches the renderer,
// which is the property that mattered.

/// Preview keys are `preview:<taskId>`; plugin surfaces are `plugin:<pluginId>:<nodeId>[:<surface>]`.
/// The prefix is what selects the policy below, so it is validated rather than assumed.
const PREVIEW_PREFIX: &str = "preview:";
const PLUGIN_PREFIX: &str = "plugin:";

/// The cookie the preview tunnel accepts in place of the `x-acorn-tunnel` header. One name, spelled
/// once here and once in `previewTunnel.ts`.
const TUNNEL_COOKIE: &str = "acorn_tunnel";

/// Matches Electron's per-renderer ceiling on preview tunnels, for the same reason: a renderer bug
/// that ensures in a loop should cost a refused call, not every webview the OS will give us.
const MAX_WEBVIEWS: usize = 32;

#[derive(Clone, Debug, PartialEq)]
enum Policy {
    Preview,
    /// The manifest host allowlist, checked here as well as in the renderer broker. Two independent
    /// checks is the point: widening the grant in one layer must not silently widen the other.
    Plugin(Vec<String>),
}

impl Policy {
    fn allows(&self, url: &str) -> bool {
        match self {
            Policy::Preview => is_allowed_preview_url(url),
            Policy::Plugin(hosts) => is_allowed_webview_url(url, hosts),
        }
    }
}

/// Where a webview has been, so back and forward can be offered honestly. wry exposes no navigation
/// history, so the shell keeps its own: `on_navigation` fires for every navigation including the ones
/// page script drives, and `traversing` marks the ones this module asked for so they move the cursor
/// instead of truncating the future.
#[derive(Default)]
struct Nav {
    entries: Vec<String>,
    index: usize,
    traversing: bool,
    loading: bool,
}

impl Nav {
    fn visited(&mut self, url: &str) {
        if self.traversing {
            self.traversing = false;
            return;
        }
        if self.entries.get(self.index).is_some_and(|current| current == url) {
            return;
        }
        if !self.entries.is_empty() {
            self.entries.truncate(self.index + 1);
        }
        self.entries.push(url.to_string());
        self.index = self.entries.len() - 1;
    }

    fn can_go_back(&self) -> bool {
        self.index > 0
    }

    fn can_go_forward(&self) -> bool {
        self.index + 1 < self.entries.len()
    }

    fn url(&self) -> String {
        self.entries.get(self.index).cloned().unwrap_or_default()
    }
}

struct Record<R: Runtime> {
    webview: Webview<R>,
    nav: std::sync::Arc<Mutex<Nav>>,
    policy: Policy,
}

/// The shell's webview state. `tunnels` is written from the helper's stdout signals, never from the
/// renderer: a renderer that could name a secret would not need one.
pub struct Webviews<R: Runtime> {
    records: Mutex<HashMap<String, Record<R>>>,
    tunnels: Mutex<HashMap<u16, String>>,
}

// Hand-written rather than derived: `derive(Default)` would ask the runtime parameter to be Default
// too, and a runtime is not a value this owns.
impl<R: Runtime> Default for Webviews<R> {
    fn default() -> Self {
        Self { records: Mutex::new(HashMap::new()), tunnels: Mutex::new(HashMap::new()) }
    }
}

impl<R: Runtime> Webviews<R> {
    /// A preview tunnel opened on this port with this secret. Called from the helper signal reader.
    pub fn tunnel_opened(&self, port: u16, secret: String) {
        self.tunnels.lock().unwrap().insert(port, secret);
    }

    pub fn tunnel_closed(&self, port: u16) {
        self.tunnels.lock().unwrap().remove(&port);
    }

    /// Close every webview. Called on the way out so a child webview cannot outlive the window it is
    /// composited over.
    pub fn dispose(&self) {
        for (_, record) in self.records.lock().unwrap().drain() {
            let _ = record.webview.close();
        }
    }
}

// ── URL policy ────────────────────────────────────────────────────────────────────────────────────
// Ports of `isAllowedPreviewUrl` (plugins/preview/src/main/browserAuto.ts) and `isAllowedWebviewUrl`
// (@acorn/protocol/webview.ts). Ported rather than called, because this is the second of the two
// independent checks and a second implementation is what makes it independent.

fn parsed(url: &str) -> Option<Url> {
    let parsed = Url::parse(url).ok()?;
    // Credentials in the authority are how a URL says one host and reaches another.
    (parsed.username().is_empty() && parsed.password().is_none()).then_some(parsed)
}

pub fn is_allowed_preview_url(url: &str) -> bool {
    parsed(url).is_some_and(|parsed| matches!(parsed.scheme(), "http" | "https") && parsed.host().is_some())
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn host_matches(hostname: &str, pattern: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let hostname = hostname.to_lowercase();
    match pattern.strip_prefix("*.") {
        // A wildcard covers the registrable host and its subdomains, and nothing else — never a
        // suffix match, which would make `evil-example.com` match `*.example.com`.
        Some(suffix) => !suffix.is_empty() && (hostname == suffix || hostname.ends_with(&format!(".{suffix}"))),
        None => hostname == pattern,
    }
}

pub fn is_allowed_webview_url(url: &str, hosts: &[String]) -> bool {
    let Some(parsed) = parsed(url) else { return false };
    let Some(host) = parsed.host_str() else { return false };
    // https everywhere, http only for loopback: a plugin surface that reaches a dev server on this
    // machine is the one case where plaintext is not a downgrade.
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && is_loopback(host)) {
        return false;
    }
    hosts.iter().any(|pattern| host_matches(host, pattern))
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StateEvent {
    key: String,
    url: String,
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
}

#[derive(Clone, Serialize)]
struct BlockedEvent {
    key: String,
    url: String,
    host: String,
}

pub const STATE_EVENT: &str = "acorn:webview-state";
pub const BLOCKED_EVENT: &str = "acorn:webview-blocked";

fn emit_state<R: Runtime>(app: &AppHandle<R>, key: &str, nav: &Nav) {
    let _ = app.emit(
        STATE_EVENT,
        StateEvent {
            key: key.to_string(),
            url: nav.url(),
            loading: nav.loading,
            can_go_back: nav.can_go_back(),
            can_go_forward: nav.can_go_forward(),
        },
    );
}

// ── Commands ──────────────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn policy_for(key: &str, hosts: Option<Vec<String>>) -> Option<Policy> {
    if let Some(task) = key.strip_prefix(PREVIEW_PREFIX) {
        // One segment, non-empty: a task id, not a path.
        return (!task.is_empty() && !task.contains(':')).then_some(Policy::Preview);
    }
    let rest = key.strip_prefix(PLUGIN_PREFIX)?;
    let segments = rest.split(':').count();
    if !(2..=3).contains(&segments) || rest.split(':').any(str::is_empty) {
        return None;
    }
    // A plugin surface with no allowlist can reach nothing, which is a refusal spelled the long way.
    let hosts = hosts.filter(|hosts| !hosts.is_empty())?;
    Some(Policy::Plugin(hosts))
}

/// Create the surface if it is not there, or re-point an existing one at a new home URL. Returns
/// false for a key this shell does not recognise, a URL the policy refuses, or a window that is gone —
/// the same three refusals `WebviewService.ensure` makes, collapsed into one boolean because the
/// caller's only move is to hide the affordance either way.
#[tauri::command]
pub fn webview_ensure<R: Runtime>(app: AppHandle<R>, key: String, url: String, hosts: Option<Vec<String>>) -> bool {
    let state = app.state::<Webviews<R>>();
    let Some(policy) = policy_for(&key, hosts) else { return false };
    if !policy.allows(&url) {
        return false;
    }

    {
        let mut records = state.records.lock().unwrap();
        if let Some(record) = records.get_mut(&key) {
            // Keep the policy current across renderer remounts: it carries no authority of its own,
            // since every operation still resolves the record by key and re-checks the URL.
            record.policy = policy;
            let current = record.nav.lock().unwrap().url();
            if current != url {
                let _ = Url::parse(&url).map(|parsed| record.webview.navigate(parsed));
            }
            return true;
        }
        if records.len() >= MAX_WEBVIEWS {
            eprintln!("[webview] refusing {key}: {MAX_WEBVIEWS} surfaces are already open");
            return false;
        }
    }

    create(&app, &key, &url, policy).is_some()
}

fn create<R: Runtime>(app: &AppHandle<R>, key: &str, home: &str, policy: Policy) -> Option<()> {
    let window = app.get_window("main")?;
    let nav = std::sync::Arc::new(Mutex::new(Nav::default()));

    let guard_nav = nav.clone();
    let guard_app = app.clone();
    let guard_key = key.to_string();
    let guard_policy = policy.clone();
    let load_nav = nav.clone();
    let load_app = app.clone();
    let load_key = key.to_string();

    let builder = WebviewBuilder::<R>::new(webview_label(key), WebviewUrl::External(Url::parse("about:blank").ok()?))
        // Ephemeral and per surface. Phase 0 confirmed a second incognito webview on the same origin
        // sees neither the localStorage nor the cookies the first one held, which is the isolation
        // Electron's non-`persist:` partition gives.
        .incognito(true)
        // Nothing composited over the shell may open a window. Electron denies through
        // `setWindowOpenHandler`; phase 0 confirmed `Deny` here makes `window.open` return null in the
        // page with no window appearing.
        .on_new_window(|url, _features| {
            eprintln!("[webview] denied window.open: {url}");
            NewWindowResponse::Deny
        })
        .on_navigation(move |url| {
            let url = url.as_str();
            // The blank page the surface is created on, so its cookie store exists before the first
            // real navigation. It is never recorded as history.
            if url == "about:blank" {
                return true;
            }
            if !guard_policy.allows(url) {
                eprintln!("[webview] blocked navigation: {url}");
                if guard_key.starts_with(PLUGIN_PREFIX) {
                    let _ = guard_app.emit(
                        BLOCKED_EVENT,
                        BlockedEvent {
                            key: guard_key.clone(),
                            url: url.to_string(),
                            host: Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| url.to_string()),
                        },
                    );
                }
                return false;
            }
            let mut nav = guard_nav.lock().unwrap();
            nav.visited(url);
            emit_state(&guard_app, &guard_key, &nav);
            true
        })
        .on_page_load(move |_webview, payload| {
            if payload.url().as_str() == "about:blank" {
                return;
            }
            let mut nav = load_nav.lock().unwrap();
            nav.loading = matches!(payload.event(), PageLoadEvent::Started);
            emit_state(&load_app, &load_key, &nav);
        });

    let webview = window
        .add_child(builder, LogicalPosition::new(0.0, 0.0), LogicalSize::new(1.0, 1.0))
        .inspect_err(|error| eprintln!("[webview] could not create {key}: {error}"))
        .ok()?;
    // Created hidden, because the renderer's order is ensure → setBounds → show and a 1×1 view in the
    // top-left corner for those two frames is a visible artefact.
    let _ = webview.hide();

    // The tunnel credential, before the first real navigation. Two constraints from phase 0 shape
    // this: the webview has to exist before its cookie store can be written, and `cookies_for_url`
    // returns nothing for an incognito webview — so from here the store is write-only, and the check
    // that the cookie arrived lives on the helper's side of the tunnel, which is where the auth is.
    seed_tunnel_cookie(app, &webview, home);

    if let Ok(parsed) = Url::parse(home) {
        let _ = webview.navigate(parsed);
    }
    app.state::<Webviews<R>>().records.lock().unwrap().insert(key.to_string(), Record { webview, nav, policy });
    Some(())
}

/// Tauri labels have their own grammar and must be unique per app; the seam's keys carry colons. One
/// deterministic rewrite, so a label can always be traced back to the surface that owns it.
fn webview_label(key: &str) -> String {
    let mut label = String::with_capacity(key.len() + 8);
    label.push_str("acorn-");
    for ch in key.chars() {
        label.push(if ch.is_ascii_alphanumeric() { ch } else { '-' });
    }
    label
}

fn seed_tunnel_cookie<R: Runtime>(app: &AppHandle<R>, webview: &Webview<R>, url: &str) {
    let Some(parsed) = Url::parse(url).ok().filter(|parsed| parsed.host_str() == Some("127.0.0.1")) else { return };
    let Some(port) = parsed.port() else { return };
    let Some(secret) = app.state::<Webviews<R>>().tunnels.lock().unwrap().get(&port).cloned() else { return };
    let cookie = Cookie::build((TUNNEL_COOKIE, secret)).domain("127.0.0.1").path("/").build();
    if let Err(error) = webview.set_cookie(cookie) {
        eprintln!("[webview] could not seed the tunnel cookie: {error}");
    }
}

#[tauri::command]
pub fn webview_bounds<R: Runtime>(app: AppHandle<R>, key: String, rect: Rect) {
    if ![rect.x, rect.y, rect.width, rect.height].iter().all(|value| value.is_finite()) {
        return;
    }
    with_record::<R, _>(&app, &key, |record| {
        let _ = record.webview.set_position(LogicalPosition::new(rect.x, rect.y));
        let _ = record.webview.set_size(LogicalSize::new(rect.width.max(0.0), rect.height.max(0.0)));
    });
}

/// `exclusive` is the preview pane's rule: one visible preview at a time, so showing one hides every
/// other surface in the same family. Plugin surfaces are independent and pass false.
#[tauri::command]
pub fn webview_show<R: Runtime>(app: AppHandle<R>, key: String, exclusive: bool) {
    let state = app.state::<Webviews<R>>();
    let records = state.records.lock().unwrap();
    if exclusive {
        if let Some(prefix) = family(&key) {
            for (other, record) in records.iter() {
                if other != &key && other.starts_with(prefix) {
                    let _ = record.webview.hide();
                }
            }
        }
    }
    if let Some(record) = records.get(&key) {
        let _ = record.webview.show();
    }
}

#[tauri::command]
pub fn webview_hide<R: Runtime>(app: AppHandle<R>, key: String) {
    with_record::<R, _>(&app, &key, |record| {
        let _ = record.webview.hide();
    });
}

/// The preview seam's `hide()`, which takes no key: every surface in one family goes away, because
/// what the caller means is "no preview is on screen right now".
#[tauri::command]
pub fn webview_hide_family<R: Runtime>(app: AppHandle<R>, prefix: String) {
    let Some(prefix) = family(&prefix) else { return };
    let state = app.state::<Webviews<R>>();
    for (key, record) in state.records.lock().unwrap().iter() {
        if key.starts_with(prefix) {
            let _ = record.webview.hide();
        }
    }
}

#[tauri::command]
pub fn webview_load<R: Runtime>(app: AppHandle<R>, key: String, url: String) -> bool {
    let state = app.state::<Webviews<R>>();
    let records = state.records.lock().unwrap();
    let Some(record) = records.get(&key) else { return false };
    if !record.policy.allows(&url) {
        return false;
    }
    Url::parse(&url).is_ok_and(|parsed| record.webview.navigate(parsed).is_ok())
}

#[tauri::command]
pub fn webview_command<R: Runtime>(app: AppHandle<R>, key: String, action: String) -> bool {
    let state = app.state::<Webviews<R>>();
    let records = state.records.lock().unwrap();
    let Some(record) = records.get(&key) else { return false };
    let webview = &record.webview;
    match action.as_str() {
        // wry has no history API, so traversal is asked of the page and the shell's own cursor is
        // moved to match. `traversing` stops the resulting `on_navigation` from truncating the future.
        "back" | "forward" => {
            let mut nav = record.nav.lock().unwrap();
            let forward = action == "forward";
            if forward && !nav.can_go_forward() || !forward && !nav.can_go_back() {
                return false;
            }
            nav.traversing = true;
            nav.index = if forward { nav.index + 1 } else { nav.index - 1 };
            let _ = webview.eval(if forward { "history.forward()" } else { "history.back()" });
            emit_state(&app, &key, &nav);
            true
        }
        "reload" => webview.reload().is_ok(),
        "stop" => webview.eval("window.stop()").is_ok(),
        // Only in a build that has them. A packaged release has no devtools to open, and the pane
        // hides the button rather than offering one that does nothing.
        #[cfg(any(debug_assertions, feature = "devtools"))]
        "devtools" => {
            if webview.is_devtools_open() {
                webview.close_devtools();
            } else {
                webview.open_devtools();
            }
            true
        }
        _ => false,
    }
}

#[tauri::command]
pub fn webview_evict<R: Runtime>(app: AppHandle<R>, key: String) {
    let state = app.state::<Webviews<R>>();
    let removed = state.records.lock().unwrap().remove(&key);
    if let Some(record) = removed {
        let _ = record.webview.close();
    }
}

fn family(key: &str) -> Option<&'static str> {
    if key.starts_with(PREVIEW_PREFIX) {
        Some(PREVIEW_PREFIX)
    } else if key.starts_with(PLUGIN_PREFIX) {
        Some(PLUGIN_PREFIX)
    } else {
        None
    }
}

fn with_record<R: Runtime, F: FnOnce(&Record<R>)>(app: &AppHandle<R>, key: &str, action: F) {
    let state = app.state::<Webviews<R>>();
    let records = state.records.lock().unwrap();
    if let Some(record) = records.get(key) {
        action(record);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_preview_url_is_http_or_https_with_no_credentials() {
        assert!(is_allowed_preview_url("http://127.0.0.1:5173/"));
        assert!(is_allowed_preview_url("https://example.com/path?q=1"));
        assert!(!is_allowed_preview_url("file:///etc/passwd"));
        assert!(!is_allowed_preview_url("app://acorn/"));
        assert!(!is_allowed_preview_url("https://user:pass@example.com/"));
        assert!(!is_allowed_preview_url("not a url"));
    }

    #[test]
    fn a_plugin_url_is_https_or_loopback_http_and_on_the_allowlist() {
        let hosts = vec!["example.com".to_string(), "*.corp.example".to_string(), "localhost".to_string()];
        assert!(is_allowed_webview_url("https://example.com/", &hosts));
        assert!(is_allowed_webview_url("https://a.corp.example/x", &hosts));
        assert!(is_allowed_webview_url("https://corp.example/x", &hosts));
        assert!(is_allowed_webview_url("http://localhost:3000/", &hosts));
        // Plain http off loopback, a host the manifest never named, and the classic suffix trick.
        assert!(!is_allowed_webview_url("http://example.com/", &hosts));
        assert!(!is_allowed_webview_url("https://elsewhere.test/", &hosts));
        assert!(!is_allowed_webview_url("https://evil-corp.example/", &hosts));
        assert!(!is_allowed_webview_url("https://user@example.com/", &hosts));
        assert!(!is_allowed_webview_url("https://example.com/", &[]));
    }

    #[test]
    fn the_key_grammar_decides_the_policy_and_nothing_else_gets_one() {
        assert_eq!(policy_for("preview:task-1", None), Some(Policy::Preview));
        assert_eq!(policy_for("preview:", None), None);
        assert_eq!(policy_for("preview:a:b", None), None);
        assert_eq!(policy_for("plugin:db:node-1", Some(vec!["example.com".into()])), Some(Policy::Plugin(vec!["example.com".into()])));
        assert_eq!(policy_for("plugin:db:node-1:pane", Some(vec!["example.com".into()])), Some(Policy::Plugin(vec!["example.com".into()])));
        // A plugin surface with no allowlist reaches nothing, so it is never created.
        assert_eq!(policy_for("plugin:db:node-1", None), None);
        assert_eq!(policy_for("plugin:db:node-1", Some(vec![])), None);
        assert_eq!(policy_for("plugin:db", Some(vec!["example.com".into()])), None);
        assert_eq!(policy_for("plugin::node-1", Some(vec!["example.com".into()])), None);
        assert_eq!(policy_for("../etc/passwd", None), None);
    }

    #[test]
    fn history_records_page_driven_navigation_and_traversal_moves_the_cursor() {
        let mut nav = Nav::default();
        nav.visited("https://a.test/");
        assert!(!nav.can_go_back() && !nav.can_go_forward());
        nav.visited("https://b.test/");
        assert!(nav.can_go_back() && !nav.can_go_forward());
        assert_eq!(nav.url(), "https://b.test/");

        // Going back is the shell's move: the cursor is set first, and the navigation it causes is
        // marked so it does not read as a new entry.
        nav.traversing = true;
        nav.index -= 1;
        nav.visited("https://a.test/");
        assert_eq!(nav.url(), "https://a.test/");
        assert!(nav.can_go_forward());

        // A fresh navigation from there drops the future, the same as any browser.
        nav.visited("https://c.test/");
        assert!(!nav.can_go_forward());
        assert_eq!(nav.entries, ["https://a.test/", "https://c.test/"]);
    }

    #[test]
    fn a_repeated_navigation_to_the_same_url_is_not_a_new_entry() {
        let mut nav = Nav::default();
        nav.visited("https://a.test/");
        nav.visited("https://a.test/");
        assert!(!nav.can_go_back());
    }

    #[test]
    fn a_label_is_derived_from_the_key_and_stays_within_the_grammar() {
        assert_eq!(webview_label("preview:task-1"), "acorn-preview-task-1");
        assert_eq!(webview_label("plugin:db:node-1:pane"), "acorn-plugin-db-node-1-pane");
        assert!(webview_label("preview:../x").chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    }
}
