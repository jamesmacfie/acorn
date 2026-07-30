# Fleet, workspaces and resource ownership

Status: **Normative**
Requirement prefix: `ARCH-OWN`

## Model

- **ARCH-OWN-001** A Fleet is the client's local view of Nodes paired to the same owner; it is not a
  server or consistency domain.
- **ARCH-OWN-002** Each Workspace MUST be stored by exactly one Node. Repository registrations and
  Tasks inherit that owner.
- **ARCH-OWN-003** A child resource MUST have the same `nodeId` as its owning parent. The API MUST
  reject a body URI whose Node differs from the request Node with `resource_node_mismatch`.
- **ARCH-OWN-004** IDs MUST be immutable UUIDv7 strings. Names, paths, provider identifiers and
  plugin keys are attributes, not resource identities.
- **ARCH-OWN-005** Canonical URIs have the form
  `acorn://<nodeId>/<resourceType>/<resourceId>`, with lowercase UUIDs and a registered lowercase
  resource type. URIs MUST NOT contain secrets, paths or display names.

Core types are `node`, `device`, `workspace`, `repository`, `task`, `agent-session`,
`workflow-run`, `terminal`, `plugin-installation`, `view-session`, `stream`, `secret-ref` and
`backup`. Plugins register `<pluginId>.<type>` types in their manifest.

## Revisions

Every mutable resource has a non-negative, monotonically increasing 64-bit `revision`, serialized as
a decimal string to avoid JavaScript precision loss. A successful mutation increments it exactly
once. Commands that affect a resource MUST carry `expectedRevision`; create commands use `"0"`.
Deliberately commutative commands MAY declare `expectedRevision: null`, but the operation contract
must explain why. Mismatch returns `revision_conflict` with the current revision and no side effect.

## Links and references

- References MUST use canonical URIs. A Node may store a remote URI as an inert external link, but
  MUST NOT dereference or mutate it without an explicit, separately authorized client operation.
- Core foreign keys MUST remain inside `core.sqlite`; plugin foreign keys remain inside that
  plugin's database. Cross-boundary references are validated URI strings, not SQL foreign keys.
- Deleting a parent uses a documented tombstone/retention policy. Events MUST retain the resource URI
  after content is redacted or removed.

## Workspace transfer

Cross-Node transfer is an explicit saga:

1. source Node freezes new Workspace mutations and creates an encrypted, signed export;
2. owner imports it into the destination, which assigns new destination resource IDs and returns a
   mapping;
3. the client verifies parity and explicitly commits;
4. source archives or deletes according to the selected retention policy.

- **ARCH-OWN-006** Transfer MUST NOT preserve source URIs as writable aliases, transfer credentials,
  transfer active PTYs/processes, or imply an atomic cross-Node commit.
- **ARCH-OWN-007** Failure before destination commit leaves the source authoritative. Failure after
  commit leaves a readable transfer record on both Nodes and requires explicit source cleanup.

## Fleet merge rules

Electron sorts and filters merged results locally. It MUST:

- retain `nodeId`, `observedAt`, staleness and authorization status on every item;
- use `(nodeId, resourceId)` as the cache/entity key;
- never collapse identical provider IDs from different Nodes;
- report partial results when Nodes are offline or incompatible; and
- route an action only through the Node encoded in the selected URI.
