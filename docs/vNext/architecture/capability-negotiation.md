# Capability negotiation

Status: **Normative**
Requirement prefix: `ARCH-CAP`

## Handshake

After mTLS authentication, the Client sends:

- supported protocol range and event schema range;
- client version, platform and architecture;
- semantic renderer capability IDs and versions;
- installed UI artifact IDs, versions and digests;
- supported compression and stream encodings; and
- the last acknowledged event cursor per subscribed channel.

The Node responds with its selected protocol, Node descriptor, core capability catalog, active
plugin descriptors, required UI artifacts by digest, unsupported/degraded features, limits and the
oldest/current event sequences.

- **ARCH-CAP-001** Selection MUST use the highest mutually supported non-preview major/minor. No
  overlap returns `protocol_incompatible` before product queries are accepted.
- **ARCH-CAP-002** Capability IDs are lowercase reverse-DNS names, optionally followed by `/major`,
  for example `acorn.code-editor/2`. Minor additions use an integer `revision`.
- **ARCH-CAP-003** A capability is usable only when identifier, major, required revision and all
  declared constraints match. Unknown capabilities are ignored, not guessed.
- **ARCH-CAP-004** Negotiation informs behavior but grants no authority. Authorization is evaluated
  independently for each operation.

## Changes

The Node emits `acorn.core.capabilities.changed.v2` after plugin activation, disablement or configuration
changes. Electron MUST re-fetch the descriptor before exposing new actions. Client renderer changes
are sent with `PUT /v2/session/capabilities` and create a new negotiated session revision.

Commands carry the expected `sessionRevision`. A command depending on a removed capability returns
`capability_unavailable` without side effects.

## Degraded modes

| Condition | Required behavior |
| --- | --- |
| Missing optional renderer | Use declared fallback; contribution remains discoverable |
| Missing required renderer | Show unsupported state and installation guidance; no command |
| Plugin disabled/unhealthy | Preserve navigation placeholder, health and recovery action |
| Node older but compatible | Hide operations above selected version |
| Event schema unsupported | Refuse subscription to that channel; allow compatible queries |
| UI artifact digest mismatch | Quarantine artifact and use declarative fallback |

- **ARCH-CAP-005** A Node MUST NOT reinterpret an unsupported renderer as HTML/Markdown or provide
  executable fallback.
- **ARCH-CAP-006** Capability catalogs MUST be stable, cacheable by descriptor ETag and free of
  secrets or machine paths.
