# Resource identities

Status: **Normative**
Requirement prefix: `CON-ID`

## URI grammar

```abnf
acorn-uri     = "acorn://" uuidv7 "/" resource-type "/" uuidv7
resource-type = label *("." label)
label         = lc-alpha *(lc-alpha / DIGIT / "-")
lc-alpha      = %x61-7A
```

Example:

```text
acorn://01935c7a-20d2-7a34-baf4-72df9230e3b1/task/01935c7e-b85d-7a98-aeac-d7710ca27f87
```

- **CON-ID-001** URI authority is the immutable Node UUIDv7. It is not DNS and MUST NOT be resolved
  through the network.
- **CON-ID-002** Core resource types are registered in
  [`../architecture/fleet-workspaces-and-resource-ownership.md`](../architecture/fleet-workspaces-and-resource-ownership.md).
  Plugin types use `<publisher>.<plugin>.<type>`.
- **CON-ID-003** URI comparison is exact byte comparison after validating the canonical lowercase
  form. Aliases, fragments, queries and percent encoding are prohibited.
- **CON-ID-004** Payloads MUST use URIs for references. Raw IDs are allowed only in a resource's own
  `id` field alongside mandatory `uri` and `nodeId`.

## Resource envelope

Every snapshot resource uses:

| Field | Type | Constraint |
| --- | --- | --- |
| `apiVersion` | string | `acorn.dev/resource/v2` |
| `kind` | string | registered resource type |
| `id` | UUIDv7 | immutable |
| `nodeId` | UUIDv7 | equals URI authority/current Node |
| `uri` | Acorn URI | canonical |
| `revision` | decimal string | starts `"1"`; increments on mutation |
| `createdAt`, `updatedAt` | timestamp | Node time |
| `deletedAt` | timestamp/null | non-null only for a tombstone |
| `labels` | object | max 32 keys and 4 KiB total; values max 256 chars |
| `spec` | object | kind schema |
| `status` | object | kind schema, computed/observed state |

- **CON-ID-005** Clients MUST treat `spec` and `status` as a single resource revision. Partial
  patching occurs only through a declared command.
- **CON-ID-006** Tombstones omit sensitive `spec/status`, retain URI/revision/times/kind, and remain
  queryable for the resource's configured retention.
- **CON-ID-007** Provider IDs, repository paths and Git refs MUST be attributes and MUST NOT become
  Acorn identity keys.

## Collections

Collection queries return `items`, an opaque `nextCursor`, `snapshotSequence`, and `observedAt`.
Cursors are scoped to exact Node, device authorization, query ID and normalized input; they expire
after 15 minutes. A cursor MUST NOT be parsed, transferred to another query or used as authority.
