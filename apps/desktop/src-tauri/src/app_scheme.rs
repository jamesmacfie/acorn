use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::http::{Request, Response, Uri};

use crate::plugin_scheme::{Frames, PLUGIN_SCHEME};

// The renderer's own origin and its Content-Security-Policy. See docs/shell.md, "Renderer origin and
// protocol handler", for every directive below and the dev-only widening.

pub const APP_SCHEME: &str = "app";
pub const APP_ORIGIN: &str = "app://acorn";

/// See docs/shell.md, "The syntax-highlighter worker's separate policy", for why this matches only
/// the highlighter's worker entry and what a rename would cost. The shared renderer Vite config sets
/// the `worker-` prefix it keys on.
fn is_highlight_worker(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("/assets/worker-highlighter.worker-") else { return false };
    let Some(hash) = rest.strip_suffix(".js") else { return false };
    !hash.is_empty() && hash.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// See docs/shell.md, "The syntax-highlighter worker's separate policy".
const WORKER_CSP: &str = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'";

/// A loaded plugin's bundle, run as a Web Worker instead of in a frame. See docs/shell.md, "The
/// plugin worker", and docs/plugins.md § The tree contract.
///
/// Tighter than the highlighter's: no `wasm-unsafe-eval`, because a plugin bundle is a stranger's
/// code and nothing it draws needs one. `connect-src 'none'` is the same load-bearing directive the
/// plugin frame origin has — fetch, XHR, WebSocket and sendBeacon all fail inside this worker, so
/// the bridge port is the only way out of it.
const PLUGIN_WORKER_CSP: &str = "default-src 'none'; script-src 'self'; connect-src 'none'";

/// `/plugin-worker/<sha256>.js`, and nothing else. The hash is validated here so the read below
/// cannot be pointed anywhere but the content-addressed cache.
fn plugin_worker_hash(path: &str) -> Option<&str> {
    let rest = path.strip_prefix("/plugin-worker/")?;
    let hash = rest.strip_suffix(".js")?;
    let lowercase_hex = hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
    if lowercase_hex { Some(hash) } else { None }
}

/// How long a content-hashed asset may be cached. A year, which is the conventional spelling of
/// "forever" for a name that changes when its bytes do.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// The bundler's digest length. Every file it writes under `assets/` is `<name>-<8 chars>.<ext>`, so
/// the length is what separates a hash from a hyphen somebody put in a filename.
const ASSET_HASH_LEN: usize = 8;

/// A content-hashed asset: `/assets/<name>-<hash>.<ext>`, and nothing nested under a directory.
///
/// These are the only responses that may be cached, because the name is the version — a rebuild emits
/// a different one and `index.html` names it. `index.html` itself is excluded by construction (it is
/// not under `/assets/`), and it has to be: it is the one file whose name never changes, so a cached
/// copy would keep pointing the window at the previous build's chunks forever.
fn hashed_asset(pathname: &str) -> bool {
    let Some(name) = pathname.strip_prefix("/assets/") else { return false };
    if name.contains('/') {
        return false;
    }
    let Some((stem, extension)) = name.rsplit_once('.') else { return false };
    if extension.is_empty() {
        return false;
    }
    let Some((before, hash)) = stem.rsplit_once('-') else { return false };
    !before.is_empty()
        && hash.len() >= ASSET_HASH_LEN
        && hash.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// `connect-src` names the helper's exact loopback WebSocket origin as well as `'self'`. No wildcard
/// port: the handler knows the port because the helper reported it, so no other local service becomes
/// reachable. The renderer still cannot reach a node directly, because a node needs the pinned agent
/// and bearer only the helper has.
///
/// `dev_server` widens it further, under `pnpm dev` only. The renderer is proxied from Vite, so the
/// page needs Vite's HMR socket and the inline preamble its plugins inject.
pub fn renderer_csp(helper_port: u16, dev_server: Option<&str>) -> String {
    // `ipc:` and `http://ipc.localhost` are Tauri's own IPC channel, a custom protocol like this one.
    // Without them every `invoke` falls back to a slower postMessage path that still works, which is
    // what makes the omission easy to ship. They reach only the commands the capability file names.
    let mut connect = format!("connect-src 'self' ipc: http://ipc.localhost ws://127.0.0.1:{helper_port}");
    let mut script = "script-src 'self'".to_string();
    if let Some(origin) = dev_server {
        let ws = origin.replacen("http://", "ws://", 1);
        connect.push_str(&format!(" {origin} {ws}"));
        script.push_str(" 'unsafe-inline'");
    }
    [
        "default-src 'self'",
        &script,
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data: blob: https:",
        &connect,
        // Monaco's five ?worker chunks, and every loaded plugin's tree worker. `blob:` covers a
        // bundler that inlines one. A plugin worker is `'self'` because it is served from this origin
        // (`plugin_worker_hash` above), which is the only way a worker script may be loaded at all.
        "worker-src 'self' blob:",
        // frame-src names only the plugin scheme, served by `plugin_scheme.rs`.
        &format!("frame-src {PLUGIN_SCHEME}:"),
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ]
    .join("; ")
}

/// Resolve a request path inside the client root, or refuse it.
///
/// The traversal guard runs after decoding, because `..` arrives percent-encoded and intact until
/// then, so normalising first proves nothing. This rejects any `..` component outright rather than
/// normalising, because a normaliser that agrees with the filesystem about symlinks is harder to be
/// sure of than a refusal.
pub fn resolve_in_root(root: &Path, pathname: &str) -> Option<PathBuf> {
    let decoded = percent_decode(pathname);
    let relative = decoded.trim_start_matches('/');
    let mut resolved = root.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(resolved)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"), 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        "png" => "image/png",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// Where the renderer comes from. Packaged builds read the staged client off disk. `pnpm dev`
/// proxies the Vite dev server, so the page keeps this origin and its policy while it keeps HMR.
/// Serving dev straight off `devUrl` would put developers on an origin the shipped app never uses.
pub enum Source {
    Files(PathBuf),
    DevServer(String),
}

pub fn serve(source: &Source, frames: Option<&Frames>, helper_port: u16, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let pathname = request.uri().path().to_string();
    let dev = match source {
        Source::DevServer(origin) => Some(origin.as_str()),
        Source::Files(_) => None,
    };

    // Ahead of everything, and identical under `pnpm dev`: a plugin worker is read from the cache,
    // never from the client root and never from Vite. Its policy is its own.
    if let Some(hash) = plugin_worker_hash(&pathname) {
        let bytes = frames.and_then(|f| f.bundle_path(hash)).and_then(|path| fs::read(path).ok());
        return match bytes {
            // A hash the cache does not hold: a bundle the owner rejected, or one that was swept. The
            // renderer draws the placeholder; nothing is fetched from the node that offered it.
            None => refuse(404),
            Some(body) => Response::builder()
                .status(200)
                .header("content-type", "text/javascript; charset=utf-8")
                .header("content-security-policy", PLUGIN_WORKER_CSP)
                .header("x-content-type-options", "nosniff")
                .header("cache-control", "no-store")
                .body(body)
                .unwrap_or_else(|_| refuse(500)),
        };
    }

    let csp = if is_highlight_worker(&pathname) { WORKER_CSP.to_string() } else { renderer_csp(helper_port, dev) };

    // Checked ahead of the source, because it is true of both. Vite answers an unknown path with the
    // shell's HTML exactly as the packaged read would.
    let (status, mime, body) = if is_node_route(&pathname) {
        refuse_node_route()
    } else { match source {
        Source::Files(root) => match read(root, &pathname) {
            Some(found) => found,
            None => return refuse(403),
        },
        Source::DevServer(origin) => match proxy(origin, request.uri()) {
            Some(found) => found,
            None => return refuse(502),
        },
    } };

    // A packaged build's `/assets/*` names are content-hashed, so the webview may keep them for
    // good and a warm launch reads a hundred fewer files off disk. `pnpm dev` gets `no-store` from
    // the same branch that widens the policy: Vite rewrites those files under the same names while
    // the developer works, so a cached copy there is a stale module with no way to notice.
    // `index.html` is `no-store` in both, which is what makes the packaged case safe — a new build's
    // hashes are always read.
    let cache = if dev.is_none() && hashed_asset(&pathname) { IMMUTABLE } else { "no-store" };

    Response::builder()
        .status(status)
        .header("content-type", mime)
        .header("content-security-policy", csp)
        .header("cache-control", cache)
        .body(body)
        .unwrap_or_else(|_| refuse(500))
}

fn read(root: &Path, pathname: &str) -> Option<(u16, String, Vec<u8>)> {
    let resolved = resolve_in_root(root, pathname)?;
    // Anything that is not a file on disk is a client-side route (/:owner/:repo/:number), so this
    // serves the shell.
    let (path, mime) = if resolved.is_file() {
        (resolved.clone(), content_type(&resolved))
    } else {
        (root.join("index.html"), "text/html; charset=utf-8")
    };
    Some((200, mime.to_string(), fs::read(path).ok()?))
}

fn proxy(origin: &str, uri: &Uri) -> Option<(u16, String, Vec<u8>)> {
    let path = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    let response = ureq::get(&format!("{origin}{path}")).call().ok()?;
    let status = response.status();
    let mime = response.content_type().to_string();
    let mut body = Vec::new();
    response.into_reader().read_to_end(&mut body).ok()?;
    Some((status, mime, body))
}

/// Nothing legitimate asks this origin for a node route, because the API is the helper socket. The
/// renderer's HTTP client falls back to a same-origin fetch whenever it has no active node, though,
/// and answering that with the shell's HTML is a 200 full of markup the caller parses as JSON. A 404
/// in the wire's own envelope says what happened.
fn is_node_route(pathname: &str) -> bool {
    pathname.starts_with("/v2/") || pathname.starts_with("/api/")
}

fn refuse_node_route() -> (u16, String, Vec<u8>) {
    (404, "application/json; charset=utf-8".into(), br#"{"error":{"code":"not_found","message":"The API is the desktop helper, not this origin."}}"#.to_vec())
}

fn refuse(status: u16) -> Response<Vec<u8>> {
    Response::builder().status(status).body(Vec::new()).expect("a bodyless response always builds")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_policy_names_the_helper_socket_and_nothing_else() {
        let csp = renderer_csp(51234, None);
        assert!(csp.contains("connect-src 'self' ipc: http://ipc.localhost ws://127.0.0.1:51234;"), "{csp}");
        assert!(csp.contains("script-src 'self';"), "{csp}");
        assert!(!csp.contains("unsafe-inline'; style"), "inline script must not be allowed in a packaged build: {csp}");
        assert!(csp.contains("frame-src app-plugin:"), "{csp}");
        assert!(csp.contains("object-src 'none'"), "{csp}");
        // No wildcard port ever reaches the directive.
        assert!(!csp.contains("127.0.0.1:*"), "{csp}");
    }

    #[test]
    fn the_dev_widening_is_dev_only() {
        let dev = renderer_csp(51234, Some("http://localhost:4319"));
        assert!(dev.contains("ws://localhost:4319"), "{dev}");
        assert!(dev.contains("script-src 'self' 'unsafe-inline'"), "{dev}");
        assert!(!renderer_csp(51234, None).contains(":4319"));
        assert!(!renderer_csp(51234, None).contains("unsafe-inline'; style"));
    }

    #[test]
    fn the_highlighter_worker_gets_its_own_policy() {
        assert!(is_highlight_worker("/assets/worker-highlighter.worker-B1a2_c3.js"));
        assert!(!is_highlight_worker("/assets/worker-highlighter.worker-.js"));
        assert!(!is_highlight_worker("/assets/worker-other.worker-abc.js"));
        assert!(!is_highlight_worker("/assets/index-abc.js"));
        assert!(WORKER_CSP.contains("'wasm-unsafe-eval'"));
    }

    #[test]
    fn the_policy_lets_a_plugin_worker_start_without_widening_frame_src() {
        let csp = renderer_csp(51234, None);
        // The directive the tree path needs. `'self'` and not the plugin scheme: a worker script has
        // to be same-origin with the document that starts it, which is why the shell serves the
        // bundle itself rather than pointing at `app-plugin://`.
        assert!(csp.contains("worker-src 'self' blob:"), "{csp}");
        // And nothing about frames moved. A tree is not a rectangle.
        assert!(csp.contains("frame-src app-plugin:"), "{csp}");
        assert!(!csp.contains("worker-src app-plugin:"), "{csp}");
    }

    #[test]
    fn only_a_content_addressed_bundle_is_a_plugin_worker() {
        const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert_eq!(plugin_worker_hash(&format!("/plugin-worker/{HASH}.js")), Some(HASH));
        assert_eq!(plugin_worker_hash(&format!("/plugin-worker/{}.js", HASH.to_uppercase())), None);
        assert_eq!(plugin_worker_hash("/plugin-worker/.js"), None);
        assert_eq!(plugin_worker_hash("/plugin-worker/../../etc/passwd.js"), None);
        assert_eq!(plugin_worker_hash(&format!("/plugin-worker/{HASH}")), None);
        assert_eq!(plugin_worker_hash("/assets/index-abc.js"), None);
        // The worker's own policy gives it nothing: no network, no `wasm-unsafe-eval`, no document.
        assert!(PLUGIN_WORKER_CSP.contains("connect-src 'none'"));
        assert!(PLUGIN_WORKER_CSP.contains("default-src 'none'"));
        assert!(!PLUGIN_WORKER_CSP.contains("wasm-unsafe-eval"));
    }

    #[test]
    fn a_plugin_worker_with_no_cache_behind_it_is_a_404_not_the_shell() {
        const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let request = Request::builder()
            .uri(format!("app://acorn/plugin-worker/{HASH}.js"))
            .body(Vec::new())
            .unwrap();
        // Before the setup hook has run there are no frames, and the answer must not fall through to
        // the client root, which would hand a Worker the shell's index.html.
        let response = serve(&Source::Files(PathBuf::from("/nowhere")), None, 51234, &request);
        assert_eq!(response.status(), 404);
    }

    #[test]
    fn a_node_route_is_not_answered_with_the_shell() {
        assert!(is_node_route("/v2/p/agents/sessions"));
        assert!(is_node_route("/api/v1/tasks"));
        assert!(!is_node_route("/owner/repo/12"));
        assert!(!is_node_route("/assets/index-abc.js"));
        let (status, mime, body) = refuse_node_route();
        assert_eq!(status, 404);
        assert!(mime.starts_with("application/json"));
        // Parseable, because whatever reached here is a JSON client by construction.
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("the refusal is JSON");
        assert_eq!(parsed["error"]["code"], "not_found");
    }

    /// Only a content-hashed name under `/assets/`, and only in a packaged build. Everything else
    /// keeps `no-store`, above all `index.html`, which is the one name a rebuild does not change.
    #[test]
    fn a_packaged_build_caches_hashed_assets_and_nothing_else() {
        let root = tempdir();
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("assets/index-B1a2_c3d.js"), b"export default 1").unwrap();
        std::fs::write(root.join("index.html"), b"<!doctype html>").unwrap();

        let cache_of = |source: &Source, path: &str| -> String {
            let request = Request::builder().uri(format!("app://acorn{path}")).body(Vec::new()).unwrap();
            let response = serve(source, None, 51234, &request);
            response.headers().get("cache-control").unwrap().to_str().unwrap().to_string()
        };

        let packaged = Source::Files(root.clone());
        assert_eq!(cache_of(&packaged, "/assets/index-B1a2_c3d.js"), IMMUTABLE);
        assert_eq!(cache_of(&packaged, "/index.html"), "no-store");
        // A client-side deep route is answered with index.html, so it must not be cached either.
        assert_eq!(cache_of(&packaged, "/owner/repo/12"), "no-store");

        // `pnpm dev` rewrites its files under the same names, so nothing it serves may be kept. The
        // proxy is unreachable from a test, and a 502 carries no cache header, so the predicate is
        // asserted directly for the dev branch.
        assert!(!hashed_asset("/index.html"));
        assert!(hashed_asset("/assets/index-B1a2_c3d.js"));
        // A hyphen in a filename is not a hash: too short, and there is a real one to compare against.
        assert!(!hashed_asset("/assets/plugin-frame.css"));
        assert!(!hashed_asset("/assets/-B1a2_c3d.js"));
        assert!(!hashed_asset("/assets/nested/index-B1a2_c3d.js"));
        assert!(!hashed_asset("/assets/index-B1a2_c3d"));
        assert!(!hashed_asset("/plugin-worker/index-B1a2_c3d.js"));

        std::fs::remove_dir_all(&root).ok();
    }

    /// A directory under the OS temp root, without pulling in a crate for it. Named by process and a
    /// counter so two tests in the same binary cannot collide.
    fn tempdir() -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!("acorn-app-scheme-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
        std::fs::create_dir_all(&dir).expect("a temp directory");
        dir
    }

    #[test]
    fn traversal_is_refused_after_decoding() {
        let root = Path::new("/app/client");
        assert_eq!(resolve_in_root(root, "/assets/index.js"), Some(root.join("assets/index.js")));
        assert_eq!(resolve_in_root(root, "/./assets/index.js"), Some(root.join("assets/index.js")));
        assert_eq!(resolve_in_root(root, "/../secrets"), None);
        // The form that only appears once the percent-decode has run, which is why the guard runs after.
        assert_eq!(resolve_in_root(root, "/%2e%2e/secrets"), None);
        assert_eq!(resolve_in_root(root, "/assets/%2E%2E/%2E%2E/secrets"), None);
    }
}
