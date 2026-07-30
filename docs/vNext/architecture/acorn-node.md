# Acorn Node

Status: **Normative**
Requirement prefix: `ARCH-NODE`

## Responsibilities

- **ARCH-NODE-001** The Node MUST own Workspace, repository, Task and plugin-installation records;
  transactional command handling; the event outbox; credentials; backups; and audit records.
- **ARCH-NODE-002** It MUST supervise worktrees, Git operations, PTYs, processes, agents, workflows,
  native plugins and WASI Components. A renderer or Electron main process MUST NOT own these.
- **ARCH-NODE-003** It MUST expose only the versioned V2 HTTPS and WebSocket surface. Database
  handles, process objects, filesystem descriptors and plugin-private services MUST NOT cross it.
- **ARCH-NODE-004** Startup MUST migrate core first, then validate plugin locks, recover interrupted
  installation/lifecycle operations, start healthy plugins, bind listeners, and finally publish
  `acorn.core.node.ready.v2`. A failed optional plugin MUST degrade that plugin rather than prevent core
  readiness.
- **ARCH-NODE-005** The Node MUST fail closed if its identity key, database schema, credential root
  key, event sequence or plugin lock cannot be validated.

## Runtime composition

The implementation MUST have these replaceable internal services:

| Service | Contract |
| --- | --- |
| Identity | Node ID, CA, server certificate, device issue/revoke/rotate |
| Authorization | Owner-device and delegated plugin capability decisions |
| Core repository | Core SQLite transactions and optimistic revisions |
| Event log | Transactional append, replay, subscription and compaction |
| Command dispatcher | Validation, idempotency, deadlines, cancellation |
| Plugin manager | Artifact locks, state machines, runtime supervision |
| Capability broker | Caller-preserving plugin-to-core/plugin calls |
| Secret broker | Opaque secret references and bound credential use |
| Stream manager | PTY/log/binary stream lifecycle and backpressure |
| Backup manager | Consistent encrypted archives and restore validation |
| Audit service | Privacy-safe, append-only security and lifecycle records |

Plugins MUST receive service capabilities, never global containers or direct core database access.

## Data root

- **ARCH-NODE-006** A Node MUST have one explicitly configured data root, mode `0700` where the OS
  supports POSIX modes. It contains `core/core.sqlite`, `plugins/<pluginId>/data.sqlite`, immutable
  artifacts, blobs, logs, encrypted backups, worktrees, and non-secret runtime state.
- **ARCH-NODE-007** Secrets and identity private keys MUST use an OS-backed credential store where
  available. If unavailable, startup MUST require an operator-supplied unlock secret; storing the
  unwrapped root key in the data root is prohibited.
- **ARCH-NODE-008** The implementation MUST obtain an exclusive process lock before opening durable
  state. A second process exits with `node_already_running`.
- **ARCH-NODE-009** Ordinary data relies on required host full-disk encryption. Fields classified
  secret or sensitive and all backups receive application-layer authenticated encryption.

## Listener and shutdown

- **ARCH-NODE-010** The Node MUST default to loopback-only. Remote listening requires an explicit
  endpoint, TLS identity and operator confirmation. V2 product routes MUST NOT be exposed over
  plain HTTP on any interface, including loopback.
- **ARCH-NODE-011** Readiness means migrations and reconciliation succeeded and the HTTPS listener
  can authenticate. Liveness MUST reveal no identity or plugin details without mTLS.
- **ARCH-NODE-012** Shutdown MUST stop accepting commands, mark the Node draining, allow committed
  commands and event flushes up to 30 seconds, cancel cancellable work, checkpoint databases, stop
  plugin runtimes, then close listeners. Forced termination is reconciled from durable state on the
  next start.

## Limits

The default limits are normative and MAY be lowered by an administrator:

| Item | Default hard limit |
| --- | ---: |
| JSON request body | 1 MiB |
| Query response | 8 MiB |
| Concurrent commands per device | 32 |
| Active view sessions per device | 64 |
| Active streams per device | 128 |
| Command deadline | 5 minutes unless operation declares another maximum |
| Device clock tolerance | 5 minutes |

Exceeding a limit MUST return a stable V2 error and MUST NOT partially perform a mutation.
