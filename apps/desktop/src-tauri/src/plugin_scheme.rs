use std::path::{Path, PathBuf};

use tauri::http::{Request, Response};

// `app-plugin://<sha256>/...` is the origin a plugin's UI runs on. Why the hash is the host, what it
// buys (isolation, immutability, custody), and why index.html is generated here rather than shipped
// by the plugin: docs/shell.md § The plugin frame origin, docs/plugins.md.
//
// Phase 0 measured this exact arrangement in WKWebView: each hash is a real origin with its own
// storage, `'self'` resolves against it, and the per-response CSP below is honoured
// (docs/shell.md § The plugin frame origin).
//
// Two things are shaped by Rust serving this rather than a Node process:
//
// The cache is read by path, not through `PluginCache`. That class lives in the helper process and
// its `path()` is `<userDataDir>/plugin-cache/<hash>.js`, so the handler resolves the same file
// itself. It is a content-addressed store: a file whose name is a 64-hex hash IS a bundle this
// device holds, and nothing else can be named.
//
// The frame stylesheet is a staged file rather than a `?raw` import, read once at boot.
// `scripts/stage.mjs` holds the ordered list of client-core modules that make it up, and
// `cssHygiene.test.ts` reads that same list to check a frame is dressed in what it needs.

pub const PLUGIN_SCHEME: &str = "app-plugin";

const CACHE_DIR: &str = "plugin-cache";

/// The plugin frame's CSP, one header on every response, and the reasoning behind each directive:
/// docs/shell.md § The plugin frame origin. `connect-src 'none'` is the load-bearing one, and
/// phase 0 confirmed a frame served this policy is network-dead in WKWebView: fetch, XHR, WebSocket
/// and sendBeacon all fail.
const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/// The generated document. Deliberately tiny: the
/// host's shared stylesheet and the plugin's module script. No inline script, no favicon, no title a
/// plugin could use to impersonate the shell in a devtools list.
///
/// The inline block sits before the stylesheet link, and that order matters: a later `html, body`
/// rule beat `base.css` on source order alone and rendered every frame in the browser's default
/// serif.
const DOCUMENT: &str = r#"<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html { color-scheme: var(--color-scheme, light dark); }
  html, body { margin: 0; height: 100%; }
</style>
<link rel="stylesheet" href="/ui.css">
</head>
<body><script type="module" src="/client.js"></script></body>
</html>
"#;

/// What the handler needs to answer: where bundles live, and the stylesheet every frame shares.
pub struct Frames {
    cache_dir: PathBuf,
    styles: Vec<u8>,
}

impl Frames {
    /// Read the staged stylesheet once. A missing one is not fatal: frames still run, they just
    /// render undressed, which is a far more legible failure than a scheme that refuses to serve.
    pub fn new(user_data_dir: &Path, styles_path: &Path) -> Self {
        let styles = std::fs::read(styles_path).unwrap_or_else(|error| {
            eprintln!("[plugin-scheme] no frame stylesheet at {}: {error}", styles_path.display());
            Vec::new()
        });
        Self { cache_dir: user_data_dir.join(CACHE_DIR), styles }
    }
}

fn is_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

pub fn serve(frames: &Frames, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // The host part IS the bundle hash. Anything that is not a hash is not a bundle this device
    // holds, so it never reaches the cache lookup.
    let hash = request.uri().host().unwrap_or_default().to_string();
    if !is_hash(&hash) {
        return respond(404, "text/plain", Vec::new());
    }

    match request.uri().path() {
        "/" | "/index.html" => respond(200, "text/html; charset=utf-8", DOCUMENT.as_bytes().to_vec()),
        // One host-owned stylesheet, identical at every plugin origin. The plugin cannot replace it.
        "/ui.css" => respond(200, "text/css; charset=utf-8", frames.styles.clone()),
        // One bundle per plugin, one file per bundle. There is no plugin-controlled asset tree: a
        // plugin that wants an image or font inlines it, keeping its hash claim exactly as auditable
        // as one file.
        //
        // The hash is checked above and a hash cannot contain a separator, so this join cannot climb
        // out of the cache directory.
        "/client.js" => match std::fs::read(frames.cache_dir.join(format!("{hash}.js"))) {
            // A hash the cache does not hold. The normal case is a bundle the owner rejected or one
            // that was swept; either way the answer is nothing, not a fetch from the node that
            // offered it.
            Err(_) => respond(404, "text/plain", Vec::new()),
            Ok(bytes) => respond(200, "text/javascript; charset=utf-8", bytes),
        },
        _ => respond(404, "text/plain", Vec::new()),
    }
}

fn respond(status: u16, mime: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("content-type", mime)
        .header("content-security-policy", CSP)
        // The bundle is served as a module script; a sniffed type is a type an attacker chose.
        .header("x-content-type-options", "nosniff")
        // Frames are hash-addressed, so the only correct cache lifetime is forever, but this is a
        // local scheme with a content-addressed store behind it: nothing to gain, and one more place
        // for stale bytes to live.
        .header("cache-control", "no-store")
        // No `x-frame-options` or `frame-ancestors`, and why: docs/shell.md § The plugin frame
        // origin.
        .body(body)
        .unwrap_or_else(|_| Response::builder().status(500).body(Vec::new()).expect("a bodyless response always builds"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(path: &str, host: &str) -> Request<Vec<u8>> {
        Request::builder().uri(format!("{PLUGIN_SCHEME}://{host}{path}")).body(Vec::new()).unwrap()
    }

    const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn only_a_lowercase_sha256_is_a_bundle_host() {
        assert!(is_hash(HASH));
        assert!(!is_hash(&HASH.to_uppercase()));
        assert!(!is_hash(&HASH[1..]));
        assert!(!is_hash("../../etc/passwd"));
    }

    #[test]
    fn the_frame_policy_is_network_dead_and_travels_on_every_response() {
        let frames = Frames { cache_dir: PathBuf::from("/nowhere"), styles: b"body{}".to_vec() };
        for (path, status) in [("/", 200), ("/ui.css", 200), ("/client.js", 404), ("/anything-else", 404)] {
            let response = serve(&frames, &get(path, HASH));
            assert_eq!(response.status(), status, "{path}");
            let csp = response.headers().get("content-security-policy").unwrap().to_str().unwrap();
            assert!(csp.contains("connect-src 'none'"), "{path}: {csp}");
            assert!(csp.contains("script-src 'self'"), "{path}: {csp}");
            assert!(csp.contains("frame-src 'none'"), "{path}: {csp}");
            assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
        }
    }

    #[test]
    fn a_host_that_is_not_a_hash_never_reaches_the_cache() {
        let frames = Frames { cache_dir: PathBuf::from("/nowhere"), styles: b"body{}".to_vec() };
        assert_eq!(serve(&frames, &get("/", "acorn")).status(), 404);
        assert_eq!(serve(&frames, &get("/client.js", "acorn")).status(), 404);
    }

    #[test]
    fn a_cached_bundle_is_served_from_the_hash_named_file() {
        let dir = std::env::temp_dir().join(format!("acorn-frames-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{HASH}.js")), b"export const ok = 1").unwrap();
        let frames = Frames { cache_dir: dir.clone(), styles: b"body{}".to_vec() };
        let response = serve(&frames, &get("/client.js", HASH));
        assert_eq!(response.status(), 200);
        assert_eq!(response.body(), b"export const ok = 1");
        assert_eq!(response.headers().get("content-type").unwrap(), "text/javascript; charset=utf-8");
        std::fs::remove_dir_all(&dir).ok();
    }
}
