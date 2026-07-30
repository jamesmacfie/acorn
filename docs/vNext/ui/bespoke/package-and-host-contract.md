# Bespoke UI package and host contract

Status: Normative<br>
Requirement prefix: `UI-BESPOKE-PKG`

Bespoke UI is an exceptional client artifact for interactions the semantic renderer catalog cannot
express. It is not remotely supplied web content and is not a way to import a plugin into Electron.

## Package

- **UI-BESPOKE-PKG-001:** A bespoke UI artifact MUST be independently content-addressed, signed,
  SBOM-bound, publisher-authorized, declared `target: client`, `runtime: bespoke-ui`, and acquired
  and verified by Electron from local cache or configured marketplace.
- **UI-BESPOKE-PKG-002:** The Node supplies only coordinate, version, artifact digest and
  contribution/view-session data. Electron MUST reject executable bytes, redirects or mutable URLs
  received from the Node as an artifact source.
- **UI-BESPOKE-PKG-003:** Package contains one static entry HTML, module assets, inert media,
  localization and a closed asset manifest. It contains no native modules, Electron preload,
  service worker, browser extension, install scripts, external module imports or runtime code
  download.
- **UI-BESPOKE-PKG-004:** All package paths use the manifest archive rules. Every member has media
  type, digest and size. Aggregate bespoke artifact limit is 50 MiB and 10,000 files unless a lower
  policy applies.
- **UI-BESPOKE-PKG-005:** Build output MUST be self-contained. Network module/CDN/font imports,
  `eval`, WebAssembly not separately declared/reviewed, source-map exposure and dynamic code
  construction are prohibited.

## Contribution declaration

A bespoke contribution declares artifact, entrypoint, host surface, minimum/maximum size class,
view-session contract, bridge methods/events, data classifications, requested guest features,
semantic fallback and mobile behavior. The authoritative signed machine declaration is
[`bespoke-view-v2.schema.json`](../../contracts/schema/bespoke-view-v2.schema.json); the positive
and authority-rejection fixtures are
[`bespoke-view.json`](../../contracts/examples/bespoke-view.json) and
[`bespoke-view-network-rejected.invalid.json`](../../contracts/examples/bespoke-view-network-rejected.invalid.json).

- **UI-BESPOKE-PKG-006:** Bridge method/event schemas and limits are signed bundle members. Runtime
  bridge registration is prohibited.
- **UI-BESPOKE-PKG-007:** A contribution cannot request arbitrary preload APIs. Guest features are
  chosen from the closed host contract and denied by default.
- **UI-BESPOKE-PKG-008:** A semantic fallback MUST expose equivalent status, recovery and critical
  actions. If full feature parity is impossible, the contribution declares the exact desktop-only
  operations and an explicit unsupported surface.
- **UI-BESPOKE-PKG-008A:** Every manifest MUST declare `bespokeViews`, even when empty. Each entry
  references exactly one `runtime: bespoke-ui`, `target: client` artifact, and its `entrypoint`
  MUST equal that artifact's entrypoint. Each host contribution that names the bespoke view MUST
  use one of its declared host surfaces and MUST name its complete declarative fallback.
- **UI-BESPOKE-PKG-008B:** The installer cross-validates trust, artifact digest/runtime/target,
  entrypoint, view-session schema, bridge operations/events, host surface, size class and fallback
  before activation. Missing or mismatched references fail the coordinated install. The schema's
  browser-authority values are immutable denials; privileged effects remain typed host methods
  with ordinary grants and confirmation, never guest browser permissions.

## Host lifecycle

1. Verify client artifact and contribution compatibility.
2. Create a unique ephemeral guest partition/origin for installation generation and view.
3. Install fixed host preload containing only bridge bootstrap.
4. Apply CSP, permissions, navigation and storage policy before navigation.
5. Navigate to verified local package origin.
6. Complete nonce-bound bridge handshake.
7. Open Node view session and issue minimum bridge grants.
8. Attach guest to allocated host bounds below trusted chrome.
9. Suspend/revoke on invisibility, context change, update or disconnect.
10. Destroy guest/partition and view session on close.

- **UI-BESPOKE-PKG-009:** A guest is scoped to one installation generation and contribution. It
  cannot share a renderer process/partition intentionally with another plugin; Chromium process
  reuse MUST preserve site isolation and storage/bridge separation.
- **UI-BESPOKE-PKG-010:** The host displays verified plugin identity, Node, connection/security
  state and overflow actions outside guest bounds. Guest content cannot cover or spoof this chrome.
- **UI-BESPOKE-PKG-011:** Crash/hang/invalid bridge behavior destroys the guest and offers host
  Reload, Fallback, Report and permitted Disable actions. Reload creates a new origin instance,
  nonce and view session.
- **UI-BESPOKE-PKG-012:** Hidden guests have bridge activity and native resources suspended after a
  short grace period. The host may destroy them under memory pressure and restore only declared
  client presentation state.

## Trust and updates

- **UI-BESPOKE-PKG-013:** Community bespoke UI is allowed only under this sandbox and receives no
  native-process authority. Acorn Verified status does not relax sandbox or bridge rules.
- **UI-BESPOKE-PKG-014:** Update verifies and creates the new guest before switching visible
  generation. State handoff uses a signed versioned bounded export/import schema, never direct
  storage sharing.
- **UI-BESPOKE-PKG-015:** A security-revoked artifact is not loaded from cache. Active guests are
  destroyed and contribution enters host quarantine/unsupported state.

## Acceptance

- **UI-BESPOKE-PKG-016:** Tests MUST substitute artifact bytes, attempt remote code/module/font
  loading, package traversal, cross-plugin storage/bridge access, host-chrome overlay, crash/hang,
  update handoff, cache revocation and semantic fallback.
