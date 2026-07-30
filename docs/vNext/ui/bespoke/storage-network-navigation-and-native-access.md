# Bespoke storage, network, navigation and native access

Status: Normative<br>
Requirement prefix: `UI-BESPOKE-AUTH`

Bespoke UI begins with no persistent storage, network, navigation, clipboard, download, filesystem,
process, terminal, Electron or native access.

## Storage

- **UI-BESPOKE-AUTH-001:** Cookies, IndexedDB, local/session storage, Cache API, service workers,
  shared workers, BroadcastChannel and shared storage are unavailable or confined to an ephemeral
  unique partition destroyed on close.
- **UI-BESPOKE-AUTH-002:** Durable plugin settings/data live on the Node; client presentation state
  uses declared bounded view bindings owned by Electron. Guest code cannot open a durable arbitrary
  key-value store.
- **UI-BESPOKE-AUTH-003:** State handoff across reload/update is a bounded schema-valid export
  selected by host and contains no credentials, capabilities, Node URLs, raw file content or
  executable data.

## Network

- **UI-BESPOKE-AUTH-004:** Guest direct network is disabled by CSP and request interception.
  `fetch`, WebSocket, EventSource, WebRTC, DNS prefetch and media/image remote requests cannot reach
  any origin.
- **UI-BESPOKE-AUTH-005:** Data access uses view-session queries/actions through the bridge. The
  Node may perform brokered HTTP under plugin permission; guest never sees provider credentials or
  an unrestricted response channel.
- **UI-BESPOKE-AUTH-006:** Broker result schemas, byte limits, redaction and caching are declared.
  A URL or header supplied by guest input is untrusted and revalidated against the operation's
  fixed egress constraints.

## Navigation

- **UI-BESPOKE-AUTH-007:** Guest cannot navigate its frame, create a new context, redirect or submit
  a form. Internal/external navigation is a typed bridge intent.
- **UI-BESPOKE-AUTH-008:** Host resolves internal resource identity and reauthorizes visibility.
  External links allow only approved schemes, display destination origin and open through Electron
  policy.
- **UI-BESPOKE-AUTH-009:** `javascript:`, `data:` documents, `file:`, `blob:` navigation, custom
  protocols, URL credentials, localhost/private targets and another plugin origin are denied unless
  a dedicated host route explicitly defines safe behavior.

## Clipboard, files and downloads

- **UI-BESPOKE-AUTH-010:** Clipboard read is denied in V2. Clipboard write is an optional one-shot
  bridge method requiring user gesture, explicit format, 1 MiB maximum and active grant.
- **UI-BESPOKE-AUTH-011:** File selection uses host picker and returns an opaque authorized resource
  handle with type/size, never an absolute path. Guest cannot choose initial directory outside host
  policy or retain the handle after view close.
- **UI-BESPOKE-AUTH-012:** Download uses a Node/blob resource, digest, media type, safe filename,
  explicit host destination and scan/quarantine policy. Guest cannot write arbitrary bytes directly.

## Native and process access

- **UI-BESPOKE-AUTH-013:** Guest cannot invoke shell/process/PTY, load native code, attach to
  terminal, call Docker, use SSH agent/keychain, reach Electron IPC or request arbitrary native
  dialogs.
- **UI-BESPOKE-AUTH-014:** A bespoke action may invoke a declared Node command that independently
  has native/process authority. The guest sees only schema-valid progress/result and cannot alter
  executable, arguments, environment or scope outside the action schema/grant.
- **UI-BESPOKE-AUTH-015:** Terminal display/input uses the standard terminal renderer, not a bridge
  raw PTY channel inside bespoke UI, unless a future bridge capability reproduces all terminal
  security/accessibility limits.

## Acceptance

- **UI-BESPOKE-AUTH-016:** Tests MUST attempt every browser storage/network/navigation/native
  primitive, URL/header substitution, clipboard without gesture, path leakage, handle reuse,
  download spoofing, arbitrary process arguments and command delegation outside scope.
