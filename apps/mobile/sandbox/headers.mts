// The headers the sandbox domain sends, by path. `build-sandbox.mjs` writes them to a `headers.json` beside the
// files it builds, for the host that serves the folder, and `pnpm dev:mobile` sends them itself. The rule for
// the exact path applies, with nothing merged from `/*`, so each set below is complete.
//
// The relay page and the Worker it starts have no network. A Worker made from a `blob:` URL takes its
// creator's policy, so `connect-src 'none'` here is also the bundle's, and `script-src 'self'` refuses a
// module it imports from another origin.
//
// The frame page is the desktop's frame policy (apps/desktop/src-tauri/src/plugin_scheme.rs) with one more
// source: `script-src` adds `blob:`, because the page imports the bytes the phone app posted from a `blob:` URL.
// `style-src 'unsafe-inline'` carries the appearance tokens, and `img-src data:` an inlined icon.
//
// Neither has a `frame-ancestors`, because the phone app frames these pages from an origin the file can't name
// (docs/shell/origins.md § The plugin worker).
const common = {
  // A sniffed type is a type an attacker chose.
  'x-content-type-options': 'nosniff',
  // The files are the same on every name, and a stale relay script is a stale security check.
  'cache-control': 'no-cache',
}

export const sandboxHeaders = {
  'content-security-policy': [
    "default-src 'none'",
    "script-src 'self'",
    'worker-src blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
  ...common,
}

export const frameHeaders = {
  'content-security-policy': [
    "default-src 'none'",
    "script-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
  ...common,
}

export const headerRules = { '/*': sandboxHeaders, '/frame.html': frameHeaders }
