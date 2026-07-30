# Markdown, media, preview and browser

Status: Normative<br>
Requirement prefix: `UI-MEDIA`

## Markdown

- **UI-MEDIA-001:** Markdown uses a fixed Acorn CommonMark profile with tables, task lists, fenced
  code and safe autolinks. Raw HTML, inline SVG, styles, scripts, iframes, forms and embedded objects
  are disabled.
- **UI-MEDIA-002:** Maximum source is 1 MiB, nesting depth 32, link count 1,000 and rendered nodes
  20,000. Parsing is cancellable and isolated from the shell event loop for large content.
- **UI-MEDIA-003:** Links become host `external` or typed resource navigation intents. Schemes are
  allowlisted; credentials, ambiguous hosts and unsafe data URLs are rejected.
- **UI-MEDIA-004:** Images resolve only through authorized Acorn blob resources or approved HTTPS
  proxy policy with size/content checks. Markdown cannot perform ambient remote requests.
- **UI-MEDIA-005:** Code fences are encoded text with syntax highlighting from trusted bundled
  grammars. Language IDs cannot load executable extensions.
- **UI-MEDIA-006:** Mentions, issue references and plugin links are parsed by declared versioned link
  providers and produce typed navigation; unknown syntax remains text.

## Media

- **UI-MEDIA-007:** Media source is an authorized immutable/streaming Acorn blob reference with
  declared media type, size, digest, sensitivity and safe filename. Client content-sniffs and
  enforces a stricter allowlist.
- **UI-MEDIA-008:** Default limits are image 25 MiB/100 megapixels, audio 100 MiB, video 250 MiB and
  downloadable artifact 512 MiB; Electron may lower limits.
- **UI-MEDIA-009:** Raster decoding occurs in hardened platform/browser decoders. SVG is sanitized
  to a non-scripted static profile or rasterized; fonts are not loaded from plugin media.
- **UI-MEDIA-010:** Audio/video never autoplay, expose transcript/captions when available, obey
  reduced motion and release decode/network resources on suspension.
- **UI-MEDIA-011:** Download is a host action with safe filename, explicit destination and
  quarantine/scan policy. It never executes or automatically opens the result.

## Preview

- **UI-MEDIA-012:** Generic preview chooses trusted renderer by validated media type: text/code,
  Markdown, image, audio/video, JSON tree, PDF host, archive listing or unsupported metadata.
- **UI-MEDIA-013:** Archive preview lists normalized bounded entries without extraction. Absolute,
  traversal, symlink, hard-link and device entries are flagged and cannot be opened as resources.
- **UI-MEDIA-014:** PDF uses a sandboxed trusted renderer with script, forms, external navigation
  and embedded file execution disabled unless a separate host capability explicitly allows them.

## Browser preview

Browser preview is an Electron-native renderer used for a task's local development URL. It is not
general plugin web access or bespoke UI.

- **UI-MEDIA-015:** The Node companion resolves and authorizes a preview target. Electron creates a
  dedicated `WebContentsView` partition with `nodeIntegration=false`, `contextIsolation=true`,
  sandbox enabled, no Acorn cookies/preloads, strict navigation and permission denial by default.
- **UI-MEDIA-023:** When the target is reachable only from a remote Node, Electron loads it through
  the task/target/view-bound preview tunnel in the stream contract and an opaque ephemeral
  Client-loopback HTTPS origin implementing `CON-PREVIEW-005` through
  `CON-PREVIEW-009`. The browser partition never receives a Node device
  credential, listener token through JavaScript, or general Node endpoint.
- **UI-MEDIA-016:** Target policy declares allowed scheme/host/port, redirect/subresource behavior,
  private-address class, certificate policy and task ownership. Every navigation revalidates it.
- **UI-MEDIA-017:** Browser chrome exposes origin, back/forward/reload, open externally, responsive
  size, error and stop. Plugin content cannot hide the origin or draw above host chrome.
- **UI-MEDIA-018:** Bounds, visibility and lifecycle are host-controlled. Hidden/closed preview
  removes or suspends native view; task/archive/plugin events cannot leave an orphan.
- **UI-MEDIA-019:** Clipboard, downloads, popups, external protocols, notifications, camera,
  microphone, geolocation, MIDI, USB, serial, Bluetooth and screen capture are denied by default and
  require dedicated host policy where ever supported.
- **UI-MEDIA-020:** Agent browser-driving is a separate task-scoped capability with auditable
  actions and snapshots. Rendering a preview does not grant it. Approved driving uses the
  non-durable `client.operation.*` exchange with the selected Client; another paired Client cannot
  answer or inherit the request.
- **UI-MEDIA-021:** Future non-Electron clients show target metadata, safe external-open intent or
  explicit desktop-required state.

## Acceptance

- **UI-MEDIA-022:** Tests MUST cover Markdown XSS/link/image attacks, parser limits, content-type
  confusion, decompression/path attacks, malicious SVG/PDF/media, download filenames, preview
  redirect/subresource escape, permission requests, popup/protocol attempts, orphan cleanup and
  unsupported-client fallback.
- **UI-MEDIA-024:** Remote-preview tests cover another Node/view/partition,
  stale/guessed port/token, malicious local origin, Host/Origin substitution,
  DNS rebinding, redirect, forbidden headers/methods, oversized bodies, late
  frames, selected-Client substitution and service-worker/cookie/cache survival.
  Only the exact active origin generation can use the tunnel and teardown
  retires all authority.
