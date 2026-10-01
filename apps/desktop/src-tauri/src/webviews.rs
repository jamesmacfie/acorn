use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::webview_target::Target;

use serde::{Deserialize, Serialize};
use tauri::webview::{Cookie, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Url, Webview, WebviewUrl};

// Host-owned child webviews: the browser preview pane and loaded-plugin webview surfaces. See
// docs/shell.md, "Host-owned webviews", for why one module covers both.
//
// wry has no `webRequest`, so there is no `onBeforeSendHeaders` to inject `x-acorn-tunnel` per
// request. The pane's cookie store is seeded before its first real navigation instead, from secrets
// the helper pushes to the shell per port. The secret never reaches the renderer.

/// Preview keys are `preview:<taskId>`; plugin surfaces are
/// `plugin:<pluginId>:<nodeId>:<surface>[:<taskId>]`.
/// The prefix selects the policy below, so it is validated rather than assumed.
const PREVIEW_PREFIX: &str = "preview:";
const PLUGIN_PREFIX: &str = "plugin:";

/// The cookie the preview tunnel accepts in place of the `x-acorn-tunnel` header. Spelled here and
/// in `previewTunnel.ts`.
const TUNNEL_COOKIE: &str = "acorn_tunnel";

/// A renderer bug that ensures in a loop should cost a refused call, not every webview the OS will
/// give us.
const MAX_WEBVIEWS: usize = 32;

#[derive(Clone, Debug, PartialEq)]
enum Policy {
    Denied,
    Preview,
    /// The manifest host allowlist, checked here and in the renderer broker. Widening the grant in
    /// one layer must not silently widen the other.
    Plugin(Vec<String>),
}

impl Policy {
    fn allows(&self, url: &str) -> bool {
        match self {
            Policy::Denied => false,
            Policy::Preview => is_allowed_preview_url(url),
            Policy::Plugin(hosts) => is_allowed_webview_url(url, hosts),
        }
    }
}

/// The navigation callback outlives an `ensure` call. Keep its grant on the same handle as the
/// record, so a refresh is observed by an already-created native view before it can navigate again.
#[derive(Clone)]
struct LivePolicy(Arc<Mutex<Policy>>);

impl LivePolicy {
    fn new(policy: Policy) -> Self {
        Self(Arc::new(Mutex::new(policy)))
    }

    fn allows(&self, url: &str) -> bool {
        self.0.lock().unwrap().allows(url)
    }

    /// Swap the whole grant under one lock. The callback never sees a partially updated host list.
    fn replace(&self, next: Policy) -> bool {
        let mut current = self.0.lock().unwrap();
        if *current == next {
            return false;
        }
        *current = next;
        true
    }
}

/// Where a webview has been, so back and forward can be offered honestly. wry exposes no navigation
/// history. `on_navigation` fires for every navigation, including the ones page script drives, and
/// `traversing` marks the ones this module asked for so they move the cursor instead of truncating
/// the future.
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
    nav: Arc<Mutex<Nav>>,
    policy: LivePolicy,
    invalidated: bool,
    home: Target,
}

/// The shell's webview state. `tunnels` is written from the helper's stdout signals, never from the
/// renderer.
pub struct Webviews<R: Runtime> {
    /// Serializes ensure/evict without holding `records` across native webview operations.
    operations: Mutex<()>,
    records: Mutex<HashMap<String, Record<R>>>,
    tunnels: Mutex<HashMap<u16, String>>,
}

// Hand-written because `derive(Default)` would ask the runtime parameter to be Default too.
impl<R: Runtime> Default for Webviews<R> {
    fn default() -> Self {
        Self { operations: Mutex::new(()), records: Mutex::new(HashMap::new()), tunnels: Mutex::new(HashMap::new()) }
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

    /// Close every webview, so none outlives the window it is composited over.
    pub fn dispose(&self) {
        let _operation = self.operations.lock().unwrap();
        let records: Vec<_> = self.records.lock().unwrap().drain().map(|(_, record)| record).collect();
        for record in records {
            record.policy.replace(Policy::Denied);
            let _ = record.webview.close();
        }
    }
}

// ── URL policy ────────────────────────────────────────────────────────────────────────────────────
// Ports of `isAllowedPreviewUrl` (plugins/preview/src/main/browserAuto.ts) and `isAllowedWebviewUrl`
// (@acorn/protocol/webview.ts). Ported rather than called: a second implementation is what makes the
// second check independent.

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
        // A wildcard covers the host and its subdomains, and nothing else. A suffix match would let
        // `evil-example.com` match `*.example.com`.
        Some(suffix) => !suffix.is_empty() && (hostname == suffix || hostname.ends_with(&format!(".{suffix}"))),
        None => hostname == pattern,
    }
}

pub fn is_allowed_webview_url(url: &str, hosts: &[String]) -> bool {
    let Some(parsed) = parsed(url) else { return false };
    let Some(host) = parsed.host_str() else { return false };
    // https everywhere, http only for loopback, where a dev server on this machine is the one case
    // plaintext is not a downgrade.
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
    if !(3..=4).contains(&segments) || rest.split(':').any(str::is_empty) {
        return None;
    }
    // A plugin surface with no allowlist can reach nothing, which is a refusal spelled the long way.
    let hosts = hosts.filter(|hosts| !hosts.is_empty())?;
    Some(Policy::Plugin(hosts))
}

/// Reconcile the configured home without resetting browsing state. Policy, capacity, creation,
/// and navigation failures return false so the caller can offer an explicit retry.
#[tauri::command]
pub fn webview_ensure<R: Runtime>(app: AppHandle<R>, key: String, url: String, hosts: Option<Vec<String>>) -> bool {
    let state = app.state::<Webviews<R>>();
    let _operation = state.operations.lock().unwrap();
    let Some(policy) = policy_for(&key, hosts) else {
        // An empty or invalid replacement grant must retire an older view with this key.
        retire_record(&state, &key);
        return false;
    };
    if !policy.allows(&url) {
        retire_record(&state, &key);
        return false;
    }

    let Ok(home) = Url::parse(&url) else { return false };
    {
        let mut records = state.records.lock().unwrap();
        if let Some(record) = records.get_mut(&key) {
            // The callback observes this swap before the native page is closed. Closing the entire
            // view cancels a navigation approved just before the swap and clears old page state.
            let changed = record.policy.replace(policy.clone());
            if !changed && !record.invalidated {
                // Browsing location is independent of the configured home, including redirects.
                let ready = record.home.reconcile(home, |target| {
                    seed_tunnel_cookie(&app, &record.webview, target.as_str());
                    record.webview.navigate(target.clone()).is_ok()
                });
                if ready {
                    emit_state(&app, &key, &record.nav.lock().unwrap());
                }
                return ready;
            }
            record.policy.replace(Policy::Denied);
            record.invalidated = true;
        }
    }
    if !retire_record(&state, &key) {
        return false;
    }
    if state.records.lock().unwrap().len() >= MAX_WEBVIEWS {
        eprintln!("[webview] refusing {key}: {MAX_WEBVIEWS} surfaces are already open");
        return false;
    }

    let Some(record) = create(&app, &key, &url, policy) else { return false };
    emit_state(&app, &key, &record.nav.lock().unwrap());
    state.records.lock().unwrap().insert(key, record);
    true
}

/// The caller holds `operations`, so no second ensure can create the same native label before the
/// old view closes. The map lock is released before `hide`, `close`, or the fallback navigation.
fn retire_record<R: Runtime>(state: &Webviews<R>, key: &str) -> bool {
    let old = {
        let mut records = state.records.lock().unwrap();
        if let Some(record) = records.get_mut(key) {
            record.policy.replace(Policy::Denied);
            record.invalidated = true;
        }
        records.remove(key)
    };
    let Some(record) = old else { return true };
    if let Err(error) = record.webview.hide() {
        eprintln!("[webview] could not hide invalidated {key}: {error}");
    }
    if let Err(error) = record.webview.close() {
        eprintln!("[webview] could not close invalidated {key}: {error}");
        // `on_navigation` admits about:blank before it checks even the denied policy. If native
        // close fails, try to unload the page; retain an unusable record so a later ensure retries.
        if let Err(blank_error) = record.webview.navigate(Url::parse("about:blank").unwrap()) {
            eprintln!("[webview] could not blank invalidated {key}: {blank_error}");
        }
        state.records.lock().unwrap().insert(key.to_string(), record);
        return false;
    }
    true
}

fn create<R: Runtime>(app: &AppHandle<R>, key: &str, home: &str, policy: Policy) -> Option<Record<R>> {
    let window = app.get_window("main")?;
    let home_url = Url::parse(home).ok()?;
    let nav = Arc::new(Mutex::new(Nav::default()));
    let live_policy = LivePolicy::new(policy);

    let guard_nav = nav.clone();
    let guard_app = app.clone();
    let guard_key = key.to_string();
    let guard_policy = live_policy.clone();
    let load_nav = nav.clone();
    let load_app = app.clone();
    let load_key = key.to_string();
    let load_policy = live_policy.clone();

    let builder = WebviewBuilder::<R>::new(webview_label(key), WebviewUrl::External(Url::parse("about:blank").ok()?))
        // Ephemeral and per surface: a second incognito webview on the same origin sees neither the
        // localStorage nor the cookies the first one held.
        .incognito(true)
        // Nothing composited over the shell may open a window. `Deny` makes `window.open` return null
        // in the page with no window appearing.
        .on_new_window(|url, _features| {
            eprintln!("[webview] denied window.open: {url}");
            NewWindowResponse::Deny
        })
        .on_navigation(move |url| {
            let url = url.as_str();
            // The blank page the surface is created on. Never recorded as history.
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
            if payload.url().as_str() == "about:blank" || !load_policy.allows(payload.url().as_str()) {
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
    // Created hidden. The renderer's order is ensure, setBounds, show, and a 1x1 view in the
    // top-left corner for those two frames is a visible artefact.
    let _ = webview.hide();

    // The tunnel credential, before the first real navigation. The webview has to exist before its
    // cookie store can be written, and `cookies_for_url` returns nothing for an incognito webview, so
    // the store is write-only from here. The helper checks that the cookie arrived.
    seed_tunnel_cookie(app, &webview, home);

    if let Err(error) = webview.navigate(home_url.clone()) {
        eprintln!("[webview] could not navigate {key}: {error}");
        let _ = webview.close();
        return None;
    }
    Some(Record { webview, nav, policy: live_policy, invalidated: false, home: Target::applied(home_url) })
}

/// Tauri labels have their own grammar and must be unique per app, and the seam's keys carry colons.
/// The rewrite is deterministic, so a label traces back to the surface that owns it.
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
pub fn webview_bounds<R: Runtime>(app: AppHandle<R>, key: String, rect: Rect, viewport: Option<crate::overlays::Viewport>) {
    if ![rect.x, rect.y, rect.width, rect.height].iter().all(|value| value.is_finite()) {
        return;
    }
    let mut sx = 1.0;
    let mut sy = 1.0;
    if let Some(viewport) = viewport {
        if !viewport.valid() { return; }
        if let Some(window) = app.get_window("main") {
            if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                sx = size.width as f64 / scale / viewport.width;
                sy = size.height as f64 / scale / viewport.height;
            }
        }
    }
    with_record::<R, _>(&app, &key, |record| {
        let _ = record.webview.set_bounds(tauri::Rect {
            position: LogicalPosition::new(rect.x * sx, rect.y * sy).into(),
            size: LogicalSize::new(rect.width.max(0.0) * sx, rect.height.max(0.0) * sy).into(),
        });
    });
}

/// `exclusive` is the preview pane's rule of one visible preview at a time, so showing one hides
/// every other surface in the same family. Plugin surfaces are independent and pass false.
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
        if !record.invalidated {
            let _ = record.webview.show();
            crate::overlays::raise(&app);
        }
    }
}

#[tauri::command]
pub fn webview_hide<R: Runtime>(app: AppHandle<R>, key: String) {
    with_record::<R, _>(&app, &key, |record| {
        let _ = record.webview.hide();
    });
}

/// A renderer reload invalidates DOM owners without retiring their kept-alive page instances.
pub fn hide_pages_on_reload<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<Webviews<R>>();
    let records = state.records.lock().unwrap();
    for record in records.values() {
        let _ = record.webview.hide();
    }
}

#[tauri::command]
pub fn webview_load<R: Runtime>(app: AppHandle<R>, key: String, url: String) -> bool {
    let state = app.state::<Webviews<R>>();
    let records = state.records.lock().unwrap();
    let Some(record) = records.get(&key) else { return false };
    if record.invalidated {
        return false;
    }
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
    if record.invalidated {
        return false;
    }
    let webview = &record.webview;
    match action.as_str() {
        // wry has no history API, so traversal is asked of the page and the shell moves its own
        // cursor to match. `traversing` stops the resulting `on_navigation` truncating the future.
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
        // A packaged release has no devtools, and the pane hides the button rather than offering one
        // that does nothing.
        #[cfg(any(debug_assertions, feature = "devtools"))]
        "devtools" => {
            if webview.is_devtools_open() {
                webview.close_devtools();
            } else {
                // The inspector belongs to this exact child handle. On macOS its first show may
                // resize the inspected WKWebView as the inspector docks. Queueing the same bounds
                // behind `open_devtools` restores the renderer-owned rectangle after that native
                // transition, even though the DOM rectangle did not change and will be memoized.
                let bounds = webview.bounds().ok();
                webview.open_devtools();
                if let Some(bounds) = bounds {
                    let _ = webview.set_bounds(bounds);
                    crate::overlays::raise(&app);
                }
            }
            true
        }
        _ => false,
    }
}

#[tauri::command]
pub fn webview_evict<R: Runtime>(app: AppHandle<R>, key: String) {
    let state = app.state::<Webviews<R>>();
    let _operation = state.operations.lock().unwrap();
    retire_record(&state, &key);
}

/// Retire even previews whose renderer tracking was lost during a main-page reload.
#[tauri::command]
pub fn webview_evict_previews<R: Runtime>(app: AppHandle<R>) {
    let state = app.state::<Webviews<R>>();
    let _operation = state.operations.lock().unwrap();
    let keys: Vec<_> = state.records.lock().unwrap().keys()
        .filter(|key| key.starts_with(PREVIEW_PREFIX)).cloned().collect();
    for key in keys {
        retire_record(&state, &key);
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
        assert_eq!(policy_for("plugin:db:node-1:pane", Some(vec!["example.com".into()])), Some(Policy::Plugin(vec!["example.com".into()])));
        assert_eq!(policy_for("plugin:db:node-1:pane:task-1", Some(vec!["example.com".into()])), Some(Policy::Plugin(vec!["example.com".into()])));
        // A plugin surface with no allowlist reaches nothing, so it is never created.
        assert_eq!(policy_for("plugin:db:node-1:pane", None), None);
        assert_eq!(policy_for("plugin:db:node-1:pane", Some(vec![])), None);
        assert_eq!(policy_for("plugin:db:node-1", Some(vec!["example.com".into()])), None);
        assert_eq!(policy_for("plugin:db", Some(vec!["example.com".into()])), None);
        assert_eq!(policy_for("plugin::node-1", Some(vec!["example.com".into()])), None);
        assert_eq!(policy_for("../etc/passwd", None), None);
    }

    #[test]
    fn a_live_navigation_guard_observes_narrowing_and_widening() {
        let policy = LivePolicy::new(Policy::Plugin(vec!["old.example".into(), "keep.example".into()]));
        let guard = policy.clone(); // The copy retained by `on_navigation` when the view is created.
        assert!(guard.allows("https://old.example/page"));
        assert!(!guard.allows("https://new.example/page"));

        assert!(policy.replace(Policy::Plugin(vec!["keep.example".into()])));
        assert!(!guard.allows("https://old.example/page"));
        assert!(guard.allows("https://keep.example/page"));

        assert!(policy.replace(Policy::Plugin(vec!["keep.example".into(), "new.example".into()])));
        assert!(guard.allows("https://new.example/page"));
        assert!(!policy.replace(Policy::Plugin(vec!["keep.example".into(), "new.example".into()])));

        policy.replace(Policy::Denied);
        assert!(!guard.allows("https://keep.example/page"));
        assert!(!guard.allows("https://new.example/page"));
    }

    #[test]
    fn history_records_page_driven_navigation_and_traversal_moves_the_cursor() {
        let mut nav = Nav::default();
        nav.visited("https://a.test/");
        assert!(!nav.can_go_back() && !nav.can_go_forward());
        nav.visited("https://b.test/");
        assert!(nav.can_go_back() && !nav.can_go_forward());
        assert_eq!(nav.url(), "https://b.test/");

        // Going back is the shell's move. The cursor is set first, and the navigation it causes is
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
