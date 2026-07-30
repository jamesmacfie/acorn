# Bespoke UI typed message bridge

Status: Normative<br>
Requirement prefix: `UI-BESPOKE-BRIDGE`

The bridge is the only guest interaction surface. It transports typed UI events and view data; it
does not expose Electron, Node, network, files, secrets or general RPC.

## Handshake

1. Host creates 256-bit one-use nonce and expected artifact/contribution/generation identities.
2. Preload sends `hello` containing bridge protocol range and nonce proof through isolated IPC.
3. Host verifies sender `webContents`, frame, origin, navigation generation and nonce.
4. Host selects bridge version and returns a short-lived view-session capability set.
5. Guest receives only method/event names, schema versions, limits and opaque session ID.

- **UI-BESPOKE-BRIDGE-001:** Messages before successful handshake, from subframes, stale navigation,
  wrong origin, wrong sender or reused nonce are dropped and counted as security health failures.
- **UI-BESPOKE-BRIDGE-002:** The guest cannot choose installation, Node, client, view-session,
  contribution, artifact or grant identity. Host attaches them from trusted embedder state.
- **UI-BESPOKE-BRIDGE-003:** Bridge capability expires after 15 minutes idle/eight hours absolute and
  is revoked on navigation, close, update, context/grant change, Node disconnect or quarantine.

## Message envelope

Every message has `protocol`, `session`, `messageId`, `kind`, `methodOrEvent`, `schemaVersion`,
`sequence`, `correlationId`, `sentAt`, and `payload`.

- **UI-BESPOKE-BRIDGE-004:** Maximum control message is 256 KiB, nesting depth 32, collection length
  10,000 and string length 64 KiB unless a method schema is lower.
- **UI-BESPOKE-BRIDGE-005:** Payloads are parsed as data into null-prototype structures, schema-
  validated with unknown fields rejected, and never passed to dynamic property assignment,
  template evaluation or IPC invocation.
- **UI-BESPOKE-BRIDGE-006:** Guest-to-host sequence is monotonic. Duplicate message ID returns the
  stored idempotent response when defined; gaps/rollback close the bridge as protocol violation.
- **UI-BESPOKE-BRIDGE-007:** Default rate is 60 messages/second, 2 MiB/second and 16 in-flight
  requests per guest, with 32 MiB maximum host-provided live data. Host may lower by method; it
  cannot raise the `view-session-v2` ceilings. Sustained violation throttles then closes/quarantines.

## Method classes

| Class | Methods |
| --- | --- |
| view | ready, get-snapshot, update-binding, invoke-action, request-page |
| presentation | request-focus, announce, set-dirty, request-close |
| navigation | request typed internal/external intent |
| host interaction | request copy/write, file picker, download, only with dedicated grant/user gesture |
| lifecycle | suspend, resume, close, capability-changed |

- **UI-BESPOKE-BRIDGE-008:** Methods are declared in the signed contribution with request/response
  schemas, deadline, idempotency, rate/byte limits and sensitivity. There is no wildcard call.
- **UI-BESPOKE-BRIDGE-009:** `invoke-action` can invoke only the view session's declared action IDs.
  Node command boundary repeats authentication, authorization, input and resource-version checks.
- **UI-BESPOKE-BRIDGE-010:** Presentation methods are advisory and cannot cover host chrome, force
  focus without current visibility/user context, create notifications, persist product state or
  approve an operation.
- **UI-BESPOKE-BRIDGE-011:** Clipboard/file/download methods require an active user gesture,
  dedicated capability, typed format/resource and host-owned confirmation where sensitive. Results
  are handles/status, not host paths.
- **UI-BESPOKE-BRIDGE-012:** Secret values are not valid bridge payloads in either direction.
  Secret editing uses host overlay controls that return only status/reference to the Node.

## Host-to-guest events

Events are `snapshot`, `patch`, `action-progress`, `action-result`, `connection-state`,
`capability-changed`, `visibility`, `theme`, `locale`, `size-class`, `suspend`, and `close`.

- **UI-BESPOKE-BRIDGE-013:** Guest validates host messages using the generated SDK; host remains
  authoritative even if guest ignores or mishandles them.
- **UI-BESPOKE-BRIDGE-014:** Patches use the same revision semantics as semantic views. A guest that
  rejects/gaps a patch requests a snapshot; it cannot request arbitrary queries.
- **UI-BESPOKE-BRIDGE-015:** Visibility/theme/locale/size events expose semantic values only and
  contain no system paths, full display inventory or owner secrets.

## Failure

- **UI-BESPOKE-BRIDGE-016:** Schema-invalid, unknown, oversized, rate-violating, post-revocation and
  repeated deadline messages receive a stable safe error or bridge close according to severity.
- **UI-BESPOKE-BRIDGE-017:** No raw thrown error, stack, IPC channel, Node response, provider body or
  security policy detail is forwarded to the guest.
- **UI-BESPOKE-BRIDGE-018:** Conformance MUST fuzz envelopes/payloads, replay/reorder, navigate
  during calls, swap frames/origins, exhaust rate/memory, invoke undeclared actions, reuse revoked
  capabilities and attempt secret/host-path reflection.
