# Electron client

Status: **Normative**
Requirement prefix: `ARCH-CLIENT`

## Boundary

- **ARCH-CLIENT-001** Electron is the only shipped V2 client. It MUST remain replaceable: product
  reads, commands and events use Node contracts rather than Electron IPC.
- **ARCH-CLIENT-002** Electron main owns windows, native menus/dialogs, OS keychain integration,
  verified UI artifact storage, sandboxed bespoke views, navigation policy and supervision of an
  optional bundled Node.
- **ARCH-CLIENT-003** The renderer MUST run with context isolation and sandboxing, without Node
  integration. It MUST NOT receive Node private keys, plaintext stored credentials, raw filesystem
  handles or an unrestricted Electron bridge.
- **ARCH-CLIENT-004** Each Node connection MUST use a separate authenticated connection context and
  cache partition. Cookies MUST NOT authenticate the V2 Node protocol.

## Fleet store

Electron persists a non-authoritative fleet index containing `nodeId`, user label, pinned server
fingerprint, endpoint candidates, client certificate reference, last connection status, negotiated
versions and per-channel replay cursors. Private keys live in the OS credential store. Removing a
Node removes local caches and certificate references but does not mutate the Node unless the client
first completes revocation.

## UI artifacts

- **ARCH-CLIENT-005** The client MUST resolve executable renderer artifacts by content digest from a
  configured marketplace or local verified cache, check signature/trust/version compatibility, and
  activate them independently of Node data.
- **ARCH-CLIENT-006** A Node descriptor MAY state required plugin and renderer digests but MUST NOT
  provide executable bytes or an executable URL to Electron.
- **ARCH-CLIENT-007** Declarative UI documents are data and MAY arrive from a Node. They MUST be
  schema-validated and rendered only through installed semantic renderer capabilities.
- **ARCH-CLIENT-008** Missing, incompatible or quarantined UI artifacts MUST produce an explicit
  degraded contribution, never silent execution or a blank pane.

## Local Node supervision

The bundled Node is a separately runnable service binary/process. Electron MUST:

1. start it with the V2 data root and an inherited bootstrap channel;
2. wait for a signed readiness response containing `nodeId`, endpoint and server fingerprint;
3. compare those values with the stored local pairing;
4. connect using the normal mTLS protocol; and
5. drain then terminate it during application shutdown.

It MUST use bounded exponential restart (1, 2, 4, 8 and 16 seconds, maximum five attempts in ten
minutes). A crash loop shows recovery UI and does not erase or recreate data. The bootstrap channel
MUST NOT become an alternate product API.

## Client state

- **ARCH-CLIENT-009** Window geometry, layouts, pane focus, local shortcuts, last-selected resources,
  theme and renderer caches are client-owned.
- **ARCH-CLIENT-010** Workspaces, tasks, plugin setup, permissions, credentials, agents and
  workflows are Node-owned. Electron MUST NOT report a cached mutation as committed.
- **ARCH-CLIENT-011** Federated search and activity are client-side merges of independently
  authorized Node responses. Each row retains its Node identity and staleness.
- **ARCH-CLIENT-012** A full-owner client MUST require OS user presence before pairing another
  device, exporting recovery material, revealing a secret, or approving unsandboxed Developer
  Source code.

## Compatibility

Electron sends its protocol range, renderer capabilities and installed UI artifact digests during
handshake. It MAY connect in read-only degraded mode when required renderers are absent, but MUST
refuse commands whose semantics are outside the negotiated protocol or capability set.
