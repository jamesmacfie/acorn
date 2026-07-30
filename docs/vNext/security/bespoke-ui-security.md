# Bespoke UI Security

Status: normative
Requirement prefix: `SEC-UI`

Bespoke UI is treated as hostile web content, including when its publisher is
Acorn Verified. A package signature does not make DOM, script, media, links, or
messages trustworthy.

## Package and origin

- **SEC-UI-001:** Electron obtains and verifies the client artifact directly
  from its configured marketplace/source. A remote Node MUST NOT send
  executable JavaScript, WebAssembly, HTML, CSS, or source maps to Electron.
- **SEC-UI-002:** Each installation loads from a unique synthetic HTTPS origin
  `https://p-<origin-id>.plugins.acorn.invalid/` served by a read-only
  content-addressed protocol handler. `origin-id` is 52 lowercase base32
  characters computed as HMAC-SHA-256 under a CMK-derived origin key over RFC
  8785 canonical `{nodeId,installationId,installationGeneration,artifactDigest,
  contributionId,viewSessionId,randomViewNonce}`, then base32 without padding.
  `randomViewNonce` is a fresh 256-bit value for every production or preview
  view. Origins and ephemeral partitions are never reused across Nodes,
  installations, generations, artifacts, contributions, preview/production
  mode or view instances and are destroyed at view closure.
- **SEC-UI-003:** Entry HTML, script, stylesheet, font, and media files must be
  listed by path, size, media type, and digest in the signed artifact manifest.
  Missing, extra, mutable, remote, or digest-mismatched resources are rejected.
- **SEC-UI-004:** The default CSP is:
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  font-src 'self'; connect-src 'none'; media-src 'self'; object-src 'none';
  frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none';
  form-action 'none'; frame-ancestors 'none'`.
  No wildcard, `unsafe-eval`, `unsafe-inline`, blob script, or remote source is
  permitted.
- **SEC-UI-005:** Responses set `X-Content-Type-Options: nosniff`, restrictive
  Permissions Policy, no-referrer, no-store, and cross-origin isolation headers.
  MIME type is derived from the signed manifest, not file extension alone.
- **SEC-UI-006:** `nodeIntegration`, Electron remote modules, preload privileges,
  web security bypasses, popups, downloads, DevTools in production, spellcheck
  provider callbacks, PDF plugins, and unreviewed browser extensions are
  disabled.
- **SEC-UI-007:** The view uses a sandboxed renderer process and a dedicated
  ephemeral session partition. It has no application cookies, HTTP auth,
  service workers, cache storage, IndexedDB, localStorage, shared storage,
  autofill, client certificates, or proxy credentials by default.

## View-session bridge

- **SEC-UI-008:** The only host interaction is a private `MessagePort` issued
  after both sides prove a random 256-bit view-session nonce. Global IPC,
  `window.opener`, arbitrary `postMessage`, custom URLs, and DOM scraping are
  forbidden bridges.
- **SEC-UI-009:** Every message carries schema version, view-session ID,
  installation ID, contribution ID, monotonically increasing sequence, request
  ID, message type, and bounded payload. Both endpoints validate the complete
  schema and reject unknown fields.
- **SEC-UI-010:** A view session is audience- and contribution-bound, inherits
  only explicitly delegated actions/data sources, expires after 15 minutes of
  inactivity and eight hours absolute, and is revoked on navigation, version
  change, permission change, Node disconnect, plugin disablement, or window
  destruction.
- **SEC-UI-011:** Effective authority is the intersection of the view's declared
  contract, plugin grant, parent client authorization, and current Node state.
  The view never receives an owner bearer credential.
- **SEC-UI-012:** Data responses use declared schemas and field sensitivity
  labels. Credentials, keys, raw authorization headers, hidden settings,
  filesystem roots, internal errors, and sibling plugin data are forbidden.
- **SEC-UI-013:** Actions are named manifest commands. Arbitrary URLs, SQL,
  shell strings, code evaluation, method names, IPC channel names, and core
  route paths cannot be supplied as action identifiers.
- **SEC-UI-014:** The host displays trusted chrome outside the plugin surface:
  plugin name, publisher/trust badge, Node/workspace, permission-sensitive
  operation indicator, and a close/stop control. Plugin pixels cannot cover or
  imitate this chrome.
- **SEC-UI-015:** Permission, pairing, credential, native execution, trust,
  update, and destructive confirmations are always Acorn-owned UI. Bespoke UI
  may request but never render or complete those ceremonies.
- **SEC-UI-016:** Clipboard read/write, file picker, external open, notification,
  camera, microphone, screen capture, geolocation, accessibility, and OS
  integration are separate mediated actions. Default is deny.
- **SEC-UI-017:** External navigation is blocked by default. Approved `https` or
  `mailto` links are shown in Acorn confirmation UI with normalized destination
  and open in the system browser, never inside the privileged Acorn origin.
- **SEC-UI-018:** File selection returns an opaque, scoped handle, not a host
  path. Upload/download still passes capability, path, type, and size checks.
- **SEC-UI-019:** Any message parse, origin, sequence, nonce, schema, or authority
  failure closes the bridge and renders a trusted error surface; it does not
  fall back to a broader API.

## Limits and abuse controls

- **SEC-UI-020:** One control message is limited to 256 KiB encoded, nesting depth 32,
  10,000 collection elements, and 64 string KiB unless its registered schema
  is stricter.
- **SEC-UI-021:** A view is limited to 60 messages/second, 2 MiB/second,
  16 concurrent requests, and 32 MiB host-provided live data.
- **SEC-UI-021A:** `view-session-v2.schema.json` carries these exact ceilings
  plus 900 idle seconds and 28,800 absolute seconds. Negotiation may only lower
  a ceiling. The host enforces the lower of schema, method and session values;
  a plugin or Node cannot raise it. Stream payloads use separately authorized
  credit-based stream frames and never bypass the control-message limit.
- **SEC-UI-022:** Host streams use explicit credit-based flow control. A view
  cannot subscribe to undeclared topics or continue after session revocation.
- **SEC-UI-023:** Repeated schema failures, rate violations, renderer crashes,
  blocked navigations, or CSP violations contribute to plugin health and can
  quarantine its client artifact.
- **SEC-UI-024:** Renderer processes receive platform resource limits. A killed
  view renders Acorn-owned recovery UI without automatically restarting a crash
  loop.

## Untrusted content rendering

- **SEC-UI-025:** Standard Markdown ignores raw HTML, sanitizes URLs, bounds
  document size/depth, and applies Acorn-owned styling. Syntax highlighting
  never executes language services supplied by content.
- **SEC-UI-026:** Terminal rendering treats escape sequences as data, disables
  host clipboard/title/link side effects, bounds scrollback, and requires
  trusted UI for opening detected links.
- **SEC-UI-027:** Editors and diff renderers do not load repository-provided
  extensions, language servers, themes, models, or scripts without a distinct
  reviewed execution grant.
- **SEC-UI-028:** Media and preview renderers sniff and constrain type, size,
  decompression, codecs, and navigation. Active web previews use the separate
  browser-preview capability and never share Acorn or plugin sessions.

## Unsupported platforms

Every bespoke contribution MUST declare a declarative fallback or an explicit
unsupported state. A client missing the artifact, required renderer, sandbox,
or security profile MUST show trusted explanatory UI and MUST NOT request the
Node to downgrade or transmit executable code.
