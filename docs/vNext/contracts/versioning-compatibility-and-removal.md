# Versioning, compatibility and removal

Status: **Normative**
Requirement prefix: `CON-VER`

## Version domains

| Domain | Version form | Compatibility |
| --- | --- | --- |
| Node HTTP/WebSocket | `major.minor` | same major, negotiated minor |
| Resource/command/event schemas | URI ending `/vN` plus SHA-256 digest | exact major; additive optional minor |
| Plugin manifest | `acorn.dev/plugin/v2` | exact major |
| Plugin/API dependencies | SemVer range plus digest locks | resolver-selected |
| WASI world | `acorn:plugin@2.x` | component-model SemVer |
| Renderer capability | identifier `/major`, integer revision | major exact; revision minimum |

- **CON-VER-001** Additive means an optional field with a documented default, a new operation, or a
  new event type. New required fields, changed defaults/meaning, enum members in a closed enum,
  relaxed security or removed behavior require a major version.
- **CON-VER-002** The handshake selects the highest mutually supported released minor. Preview
  versions require an explicit developer setting and cannot access production credentials by
  default.
- **CON-VER-003** Descriptors MUST provide schema digest, introduced version, deprecation version
  and removal version for every operation/event/capability.

## Deprecation

A public contract is supported for at least two consecutive minor releases and 180 days after
deprecation, unless responding to an active security vulnerability. Deprecation is exposed in
descriptors and response `Deprecation`/`Sunset` headers. Security removal records rationale and
migration guidance.

## Plugin compatibility

The plugin lock resolves exact plugin/artifact versions, digests, runtime, dependency versions,
protocol range and renderer requirements. A Node never auto-selects a different major. Activation is
atomic only after both Node and Electron artifacts satisfy the coordinated installation plan.

- **CON-VER-004** Unknown plugin dependencies, event schemas or requested capabilities fail
  installation before migrations.
- **CON-VER-005** Optional dependency absence disables only contributions explicitly guarded by it.
  Plugin code cannot probe undeclared plugins.

## Clean V2 break

- **CON-VER-006** V2 uses a new data root, Node identity, client device certificates, protocol base,
  plugin manifests, database schemas, event sequences and credentials.
- **CON-VER-007** `/api/v1`, its bearer tokens, same-origin cookies, WebSocket cursors and
  idempotency records are not recognized by V2 and are not proxied.
- **CON-VER-008** The importer may copy validated repository/workspace configuration into V2 with
  new IDs. It MUST NOT import V1 tasks, agents, terminals, workflows, notes, memories, plugin data,
  API tokens, OAuth/provider credentials, preferences, event history or IndexedDB state.
- **CON-VER-009** V1 remains readable by the V1 application until the owner removes it. V2
  installation MUST NOT migrate, modify, delete or lock the V1 root.
