// The headers every response on the sandbox domain carries. `build-sandbox.mjs` writes them to
// `dist-sandbox/headers.json` for the host that serves the folder, and `pnpm dev:mobile` sends them itself.
//
// The relay page and the Worker it starts have no network. A Worker made from a `blob:` URL takes its
// creator's policy, so `connect-src 'none'` here is also the bundle's, and `script-src 'self'` refuses a
// module it imports from another origin. There is no `frame-ancestors`, because the phone app frames this
// page from an origin the file can't name (docs/shell/origins.md § The plugin worker).
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
  // A sniffed type is a type an attacker chose.
  'x-content-type-options': 'nosniff',
  // The files are the same on every name, and a stale relay script is a stale security check.
  'cache-control': 'no-cache',
}
