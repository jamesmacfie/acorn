# Runtime and process boundaries

Status: **Normative**
Requirement prefix: `ARCH-BOUND`

## Dependency direction

```text
Electron renderer → Electron client services → V2 protocol
                                             ↓
Node transport → application services → core repositories/runtime brokers
                                      ↘ plugin capability broker
```

- **ARCH-BOUND-001** Core domain services MUST NOT import Electron, renderer or plugin
  implementations.
- **ARCH-BOUND-002** A plugin MAY import the versioned plugin SDK and its own code only. It MUST NOT
  import another plugin, core implementation files or the application composition root.
- **ARCH-BOUND-003** Composition roots register manifests and implementations against typed
  contracts; registries freeze before accepting product traffic.
- **ARCH-BOUND-004** All inter-process values MUST be serializable, schema-validated and bounded.
  Handles, callbacks, database clients and process objects cannot cross a boundary.

## Process classes

| Process | Authority | Isolation |
| --- | --- | --- |
| Electron main | Native presentation, UI artifacts, local Node supervision | OS app sandbox where available |
| Electron renderer | Product UI only | Chromium sandbox, context isolation, CSP |
| Acorn Node | Owner-authorized machine operations | Dedicated service identity/data root |
| WASI Component | Granted component capabilities only | Wasmtime component sandbox, no ambient WASI |
| Verified native plugin | Manifest capabilities | Mandatory per-OS process sandbox |
| Developer Source native plugin | Local user authority | Unsandboxed only after explicit RCE warning |

In-process execution is reserved for System plugins shipped and signed with the Node.

## Native adapters

- **ARCH-BOUND-005** Native presentation operations (folder chooser, browser view, clipboard,
  notifications) MUST be Electron-owned named renderer capabilities, not generic Node commands.
- **ARCH-BOUND-006** Machine operations (filesystem, Git, PTY, process, Docker) MUST be Node-owned
  core capabilities, even when historically implemented beneath Electron main.
- **ARCH-BOUND-007** Capability requests MUST include target resource, caller identity, delegated
  grants, purpose and deadline. The broker reauthorizes every call.

## Failure containment

Plugin crashes, invalid messages, quota violations and timeouts increment health counters and can
trigger restart or quarantine. A plugin crash MUST NOT terminate the Node. A Node crash MUST NOT
terminate Electron; cached data remains explicitly stale. A bespoke renderer crash MUST affect only
its isolated view.

- **ARCH-BOUND-008** No process supervisor may retry indefinitely. Default plugin restart is at most
  5 attempts in 10 minutes with exponential backoff; exhaustion enters `unhealthy`.
- **ARCH-BOUND-009** Quarantine disables execution and contributions while preserving data and
  diagnostic metadata. Only an owner action or a verified artifact replacement exits quarantine.
