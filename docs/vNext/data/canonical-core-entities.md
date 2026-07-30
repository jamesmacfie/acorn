# Canonical core entities

Status: **Normative**
Requirement prefix: `DATA-ENT`

All IDs are UUIDv7, timestamps are Node-generated UTC, and revisions start at 1. Paths are never
identities.

## Node and device

| Entity | Required domain fields | Invariants |
| --- | --- | --- |
| Node | `nodeId`, display name, fingerprint, created time | exactly one per data root |
| Device | `deviceId`, label, platform, certificate serial, expiry, status | full owner; status active/revoked |
| Pairing session | verifier, expiry, attempts, creator, claimed device | one use; 10 minutes; five attempts |

## Workspace graph

- **DATA-ENT-001** Workspace: `id`, `name`, icon/color, archived state, revision. A Node may own many.
- **DATA-ENT-002** Repository: `id`, canonical real path, display name, VCS type, remote metadata,
  configuration trust digest and revision. Real paths MUST be unique per Node using OS-appropriate
  normalized comparison.
- **DATA-ENT-003** WorkspaceRepository joins one Repository to exactly one active Workspace. Moving
  it is revision-checked and emits removal/addition facts in one core transaction.
- **DATA-ENT-004** Task: Workspace and Repository URIs, name, branch, worktree descriptor, origin,
  archived state and revision. Workspace and Repository must share the Node and membership.

Worktree descriptor is `{kind: main|linked, relativePath, headRef, baseRef|null, state:
pending|ready|missing|removing|failed}`. `relativePath` is interpreted only beneath the configured
worktree root after canonical containment checks.

Task origin is `{kind: local|github-pr|linear|rollbar|plugin, providerRef|null}`. `providerRef` is
opaque plugin-owned data capped at 2 KiB; it does not grant access.

## Runtime resources

| Entity | Required fields | Owner |
| --- | --- | --- |
| Operation | command, target, state, progress, commit point, result/error | Core broker |
| Saga | operation, ordered steps, compensation state | Core broker |
| View session | device, contribution, document digest/revision, expiry, grants | Core broker |
| Stream | owner resource, device, media type, direction, offsets, state, expiry | Core broker |
| Plugin installation | coordinate, exact version/digests, state, health, schema version | Plugin manager |
| Capability grant | installation, capability, scope URI, constraints, status | Authorization |
| Secret reference | owner installation, scope URI, purpose, key-store locator, lifecycle | Secret broker |
| Backup | scope, snapshot sequence, encrypted archive digest, key envelope, state | Backup manager |

## Event and command identities

- **DATA-ENT-005** Command ID identifies one device-bound request and cannot be reused for different
  canonical content.
- **DATA-ENT-006** Event ID identifies one immutable fact. Sequence is Node-global and defines
  delivery order, not causality. `commandId` and `causationEventId` express causality.
- **DATA-ENT-007** Operation and stream resources remain queryable after terminal state for seven
  days; content-specific retention may be shorter. Tombstones remain 30 days unless a plugin
  declares longer owner-data retention.

## Validation

Domain JSON stored in SQLite MUST be validated on write and read against a digest-pinned schema.
Malformed persisted JSON is corruption: quarantine the owning plugin/resource and fail closed rather
than applying defaults that change meaning.
