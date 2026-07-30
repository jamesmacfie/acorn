# Offline, stale and degraded states

Status: Normative<br>
Requirement prefix: `UI-OFFLINE`

The Fleet shell remains usable when a Node, plugin, dependency, renderer or network is unavailable.
The UI MUST distinguish freshness from authorization and capability.

## Standard states

| State | Meaning | Mutation policy |
| --- | --- | --- |
| `loading` | no authoritative result yet | disabled |
| `refreshing` | authorized snapshot visible, refresh in progress | allowed if command policy permits |
| `stale` | cached snapshot past freshness or events interrupted | disabled by default |
| `offline` | Node unreachable | disabled |
| `degraded` | optional behavior unavailable | unaffected operations allowed |
| `blocked` | required permission/setup/dependency unavailable | disabled with recovery |
| `unsupported` | client lacks renderer/platform capability | disabled or semantic fallback |
| `unauthorized` | current device/grant cannot read/act | disabled; no cached body shown |
| `not-found` | resource no longer exists | disabled; remove navigation option |
| `error` | bounded operation failure | according to known commit outcome |

- **UI-OFFLINE-001:** Every data surface MUST expose source Node, last successful refresh, current
  connection and state from the table. A spinner alone is not an indefinite failure state.
- **UI-OFFLINE-002:** Cached confidential content is hidden immediately on authorization
  revocation, owner profile change or Node identity mismatch even if the Node is offline.
- **UI-OFFLINE-003:** Offline mutation is not generally queued. Only commands explicitly declared
  offline-safe, idempotent and conflict-resolvable may queue, and the owner sees/can cancel each.
- **UI-OFFLINE-004:** Unknown command outcome is displayed as `outcome_pending`; the client queries
  idempotency outcome after reconnect rather than encouraging duplicate execution.
- **UI-OFFLINE-005:** An expired event cursor triggers authorized snapshot resynchronization for
  that Node/source. Electron labels the projection resyncing and does not merge stale and fresh
  revisions as one state.

## Node and plugin failure

- **UI-OFFLINE-006:** Node connection state is `connecting`, `online`, `degraded`, `offline`,
  `identity_changed`, `revoked` or `incompatible`. Identity change is a security stop, never a
  reconnect warning.
- **UI-OFFLINE-007:** Plugin state is `ready`, `degraded`, `blocked`, `disabled`, `unhealthy`,
  `quarantined`, `updating` or `missing`. The surface shows the core-computed reason and safe
  recovery command.
- **UI-OFFLINE-008:** A plugin failure affects its contributions and required dependants only. Shell,
  settings, plugin management, Node management and unaffected tasks remain usable.
- **UI-OFFLINE-009:** A bespoke guest crash produces a host error with Reload View, Use Fallback,
  Report, and when allowed Disable Plugin. Reload creates a new guest and view session.

## Streams

- **UI-OFFLINE-010:** Terminal, logs, agents and other streams show `live`, `paused`, `reconnecting`,
  `ended`, `truncated` or `disconnected`, plus last sequence and dropped-byte indication.
- **UI-OFFLINE-011:** Reconnect uses stream resume token/sequence when retained. A gap inserts a
  host discontinuity marker; it never concatenates non-contiguous output silently.
- **UI-OFFLINE-012:** Terminal/agent input is disabled while disconnected. Buffered keystrokes are
  discarded, not replayed after reconnect.

## Acceptance

- **UI-OFFLINE-013:** Tests MUST disconnect each Node independently during read, mutation, wizard,
  event replay and stream; revoke authorization while offline; exceed replay retention; crash one
  plugin/guest; and prove accurate state, no accidental replay and continued Fleet-shell operation.
