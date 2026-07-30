# V2 system overview

Status: **Normative**
Requirement prefix: `ARCH-SYS`

This document defines the V2 deployment model. Terms have the meanings in
[`../glossary.md`](../glossary.md); wire details are normative in
[`../contracts/`](../contracts/).

## Invariants

- **ARCH-SYS-001** An **Acorn Node** MUST be an Electron-free service. It owns domain execution,
  durable product state, plugin runtimes, worktrees, processes, PTYs, provider access and the
  authoritative event log.
- **ARCH-SYS-002** An **Acorn Client** MUST be a presentation and control client. V2 ships an
  Electron client; Tauri, mobile and relay implementations are not V2 deliverables.
- **ARCH-SYS-003** A **Fleet** MUST contain one or more independently administered Nodes paired to
  the owner's clients. A Node MUST continue to operate when every Client is disconnected.
- **ARCH-SYS-004** One Node MAY own many Workspaces. A Workspace MUST have exactly one owning Node.
  Moving it is an explicit export/import operation, never transparent replication.
- **ARCH-SYS-005** Every durable or actionable resource MUST have a node-qualified identity.
  A mutation MUST target one Node. V2 MUST NOT implement cross-Node transactions.
- **ARCH-SYS-006** The Node MUST expose the same HTTPS and event contracts whether it is supervised
  by Electron on the same device or installed independently.
- **ARCH-SYS-007** Product authentication MUST identify an Acorn client device, not a GitHub or
  provider account. Provider identities are plugin-owned credentials selected after Acorn
  authorization.
- **ARCH-SYS-008** Remote Nodes MUST NOT deliver executable UI code. Electron acquires and verifies
  UI artifacts independently; a Node supplies only signed artifact identities and declarative data.
- **ARCH-SYS-009** Node core state and each plugin's durable state MUST be physically separated
  SQLite databases. Core brokers all cross-plugin interaction.
- **ARCH-SYS-010** Fresh V2 state MUST use a new data root. V1 data and `/api/v1` credentials MUST
  remain untouched and invalid in V2.

## Logical topology

```text
                           optional future relay
                         (opaque encrypted frames)
                                   │
┌──────────────────── Electron Client ─────────────────────┐
│ Fleet index · layouts · verified UI artifacts · caches   │
└─────────────┬──────────────────────┬───────────────────────┘
              │ TLS 1.3 + mTLS       │ TLS 1.3 + mTLS
              │ HTTP + WebSocket     │ HTTP + WebSocket
┌─────────────▼────────────┐   ┌─────▼──────────────────────┐
│ bundled Acorn Node       │   │ independent remote Node   │
│ core.db + plugin DBs     │   │ core.db + plugin DBs      │
│ plugins · worktrees      │   │ plugins · worktrees       │
│ processes · event log   │   │ processes · event log     │
└──────────────────────────┘   └────────────────────────────┘
```

The Client federates read results and attention indicators, but it never creates a fleet-wide
source of truth. Each result retains its `nodeId`; command routing is deterministic.

## Ownership matrix

| Concern | Authoritative owner | Client behavior |
| --- | --- | --- |
| Workspaces, repositories, tasks, agents, workflows | Node | Cache and render |
| Worktrees, files, Git, PTYs and child processes | Node | Invoke and stream |
| Plugin installation on Node | Node | Coordinate and display |
| UI artifact installation | Client | Verify and render |
| Fleet membership and device labels | Each paired Node plus local fleet index | Reconcile per Node |
| Layout, focus, window geometry, keybindings | Client device | Persist locally |
| Credentials used by Node plugins | Node credential vault | Submit write-only secret values |
| Event history | Node outbox | Track per-Node cursor and resync |
| Provider mirrors | Owning plugin on Node | Treat as stale-capable projections |

## End-to-end flows

### Read

1. Electron chooses a Node from the node-qualified resource.
2. It sends an authenticated HTTPS query with a request ID.
3. The Node authorizes the client, reads core or plugin-owned state through a registered service,
   and returns a snapshot with `revision` and `observedAt`.
4. Electron caches the response in the partition for that Node and renders it. Cache content never
   grants authority.

### Mutation

1. Electron sends a command with a UUIDv7 `commandId`, expected resource revision, and deadline.
2. The Node authenticates, authorizes and validates before starting work.
3. The owning service commits its state and transactional outbox event atomically.
4. The response reports the committed revision and event sequence. At-least-once event delivery may
   repeat the same event; clients deduplicate by `eventId`.

### Local bundle

Electron starts the local Node, obtains its endpoint through the supervised bootstrap channel, and
uses a pre-paired device certificate held by the OS credential store. Native dialogs and browser
views remain Electron capabilities invoked through client-owned renderers; they are not Node APIs.

## Explicit non-goals

- **ARCH-SYS-011** V2 MUST NOT provide shared multi-user authorization, cross-Node state
  replication, cross-Node transactions, remote executable renderer delivery, or an implicit
  provider identity.
- **ARCH-SYS-012** Relay and mobile implementations are deferred, but V2 contracts MUST use opaque
  node-qualified resources, renderer capability negotiation and application messages that can be
  transported without relying on Electron IPC or a same-origin browser session.
