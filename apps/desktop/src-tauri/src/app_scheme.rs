use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::http::{Request, Response, Uri};

use crate::plugin_scheme::PLUGIN_SCHEME;

// The renderer's own origin and its Content-Security-Policy. Every directive below is recorded in
// docs/shell.md § Renderer origin and protocol handler, along with the dev-only widening.

pub const APP_SCHEME: &str = "app";
pub const APP_ORIGIN: &str = "app://acorn";

/// Why this pattern matches only the highlighter's worker entry, and what a rename would cost:
/// docs/shell.md § The syntax-highlighter worker's separate policy. The `worker-` prefix it keys on
/// is set by the shared renderer Vite config, so it travels to both shells.
fn is_highlight_worker(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("/assets/worker-highlighter.worker-") else { return false };
    let Some(hash) = rest.strip_suffix(".js") else { return false };
    !hash.is_empty() && hash.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The highlighter worker's separate policy: docs/shell.md § The syntax-highlighter worker's
/// separate policy.
const WORKER_CSP: &str = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'";

/// The one CSP change against Electron: `connect-src` names the helper's exact loopback WebSocket
/// origin as well as `'self'` (docs/future/tauri/architecture.md § The one CSP change). No wildcard
/// port — the handler knows the port because the helper reported it, so no other local service becomes
/// reachable. Everything that directive protected still holds: the renderer still cannot reach a node
/// directly, because a node needs the pinned agent and bearer only the helper has.
///
/// `dev_server` widens it further, and only under `pnpm dev`: the renderer is proxied from Vite,
/// so the page needs Vite's HMR socket and the inline preamble its plugins inject. A packaged build
/// passes `None` and gets exactly Electron's policy plus the helper socket.
pub fn renderer_csp(helper_port: u16, dev_server: Option<&str>) -> String {
    // `ipc:` and `http://ipc.localhost` are Tauri's own IPC channel, which is a custom protocol like
    // this one. Without them every `invoke` silently falls back to a slower postMessage path — it still
    // works, which is what makes the omission easy to ship. They reach only the commands in
    // `commands.rs`, and the capability file is what says which those are.
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
        // Monaco's five ?worker chunks; blob: covers a bundler that inlines one.
        "worker-src 'self' blob:",
        // frame-src names only the plugin scheme: docs/shell.md § Renderer origin and protocol
        // handler. `plugin_scheme.rs` is what serves it.
        &format!("frame-src {PLUGIN_SCHEME}:"),
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ]
    .join("; ")
}

/// Resolve a request path inside the client root, or refuse it.
///
/// The traversal guard is checked after decoding, for the reason Electron's is: `..` arrives
/// percent-encoded and intact until the decode runs, so normalising before that proves nothing. This
/// rejects any `..` component outright rather than normalising, because a normaliser that agrees with
/// the filesystem about symlinks is a much harder thing to be sure of than a refusal.
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

/// Where the renderer comes from. Packaged builds read the staged client off disk; `pnpm dev`
/// proxies the Vite dev server, so the page keeps this origin — and everything phase 0 verified about
/// it — while it keeps HMR. Serving dev straight off `devUrl` would put developers on an origin the
/// shipped app never uses, which is the one thing this migration cannot afford.
pub enum Source {
    Files(PathBuf),
    DevServer(String),
}

pub fn serve(source: &Source, helper_port: u16, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let pathname = request.uri().path().to_string();
    let dev = match source {
        Source::DevServer(origin) => Some(origin.as_str()),
        Source::Files(_) => None,
    };
    let csp = if is_highlight_worker(&pathname) { WORKER_CSP.to_string() } else { renderer_csp(helper_port, dev) };

    // Checked ahead of the source, because it is true of both: Vite answers an unknown path with the
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

    Response::builder()
        .status(status)
        .header("content-type", mime)
        .header("content-security-policy", csp)
        // The renderer is rebuilt on every launch and its filenames are content-hashed, so there is
        // nothing a cache would save that the disk read does not already give.
        .header("cache-control", "no-store")
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

/// Nothing legitimate asks this origin for a node route: the API is the helper socket. But the
/// renderer's HTTP client falls back to a same-origin fetch whenever it has no active node yet, and
/// answering that with the shell's own HTML is a 200 full of markup that the caller then parses as
/// JSON. A 404 in the wire's own envelope says what actually happened.
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
