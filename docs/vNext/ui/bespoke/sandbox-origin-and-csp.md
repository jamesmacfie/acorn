# Bespoke UI sandbox, origin and CSP

Status: Normative<br>
Requirement prefix: `UI-BESPOKE-SBX`

## Electron boundary

- **UI-BESPOKE-SBX-001:** Guest `webPreferences` MUST set `nodeIntegration=false`,
  `nodeIntegrationInWorker=false`, `nodeIntegrationInSubFrames=false`, `contextIsolation=true`,
  `sandbox=true`, `webSecurity=true`, `allowRunningInsecureContent=false`, spellcheck by explicit
  host policy, and a fixed Acorn bridge preload.
- **UI-BESPOKE-SBX-002:** The guest receives no `remote`, Electron API, Node built-in, native addon,
  host preload object, inspector in production, Acorn cookie, authorization header or Node URL.
- **UI-BESPOKE-SBX-003:** Each view receives opaque HTTPS origin
  `https://p-<origin-id>.plugins.acorn.invalid/` mapped internally to one verified artifact root.
  Origin ID uses the keyed Node/installation/generation/artifact/contribution/session/random-nonce
  derivation in `SEC-UI-002`; it reveals none of those values and is never reused, including across
  simultaneous views, preview/production, update or two Nodes with the same coordinate.
- **UI-BESPOKE-SBX-004:** Session partition is `temporary`, unique to the guest instance and
  destroyed on close. Persistent storage is denied unless a future reviewed capability defines
  bounded host-owned storage; V2 bespoke UI uses view bindings for state.
- **UI-BESPOKE-SBX-005:** `webview`, nested `iframe`, popup, auxiliary browsing context and guest-
  created window are prohibited. A renderer requiring child documents uses semantic host content.

## Content Security Policy

Minimum policy:

```text
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' data:;
font-src 'self';
media-src 'self' blob:;
connect-src 'none';
worker-src 'none';
child-src 'none';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none';
navigate-to 'none';
require-trusted-types-for 'script';
```

- **UI-BESPOKE-SBX-006:** The host generates CSP; plugin HTML cannot weaken it with a meta tag.
  Inline script/style, `unsafe-eval`, remote sources, data/blob scripts and dynamic import outside
  verified package members are prohibited.
- **UI-BESPOKE-SBX-007:** Trusted Types policy is host-created only when Electron's Chromium
  supports it; lack of support does not relax encoding/sanitization requirements.
- **UI-BESPOKE-SBX-008:** `img-src data:` accepts only host-validated bounded raster data; SVG and
  HTML data URLs are rejected. Blob URLs are host-tracked and revoked on view close.

## Permissions and navigation

- **UI-BESPOKE-SBX-009:** Electron session permission handlers deny notifications, clipboard,
  media, display capture, geolocation, MIDI, HID, USB, serial, Bluetooth, pointer lock, fullscreen,
  idle detection, file-system access and payment by default.
- **UI-BESPOKE-SBX-010:** `will-navigate`, redirects, `window.open`, downloads and external
  protocols are blocked. A typed bridge navigation intent asks the host to perform safe navigation.
- **UI-BESPOKE-SBX-011:** Requests are intercepted. Only verified package-origin GET/HEAD members
  and host-created blob resources are served. HTTP(S), file, data documents, extension, devtools,
  localhost, Node API and another plugin origin are denied.
- **UI-BESPOKE-SBX-012:** Response headers include CSP, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`, no-store cache policy for
  sensitive view data and COOP/COEP policy where compatible.

## Host integrity

- **UI-BESPOKE-SBX-013:** The bridge preload is Acorn release code, contains no plugin-specific
  branching and exposes one frozen object with handshake/send/subscribe/close primitives.
- **UI-BESPOKE-SBX-014:** Host chrome and permission/security dialogs render in the embedder, not
  the guest, and stay above/clipped outside guest bounds.
- **UI-BESPOKE-SBX-015:** DevTools for a guest are disabled in production. Developer mode makes the
  risk visible, excludes Node/secret authority and audit-records opening.

## Acceptance

- **UI-BESPOKE-SBX-016:** Automated malicious fixtures MUST try Node/Electron access, CSP bypass,
  eval/import, worker/service worker, iframe/window, navigation, download, every browser permission,
  local/network request, cross-origin storage and host overlay. Release fails on any escape.
