# Normative conventions

**Status:** Normative<br>
**Requirement prefix:** `SPEC`

## Requirement language

The words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are interpreted
as described by RFC 2119 and RFC 8174 when written in uppercase.

`SPEC-001` Every enforceable requirement MUST have a globally unique identifier in the form
`<AREA>-<three digits><optional uppercase suffix>`. The suffix is used only to insert a requirement
without renumbering referenced identifiers. Threats use `THREAT-<AREA>-<three digits><suffix>` and
acceptance cases use `ACCEPT-<AREA>-<three digits><suffix>`.

`SPEC-002` Normative tables, schemas, state machines, and machine-readable artifacts are requirements
even when individual rows do not repeat uppercase requirement language.

## Authority and precedence

Where two artifacts conflict, use this precedence:

1. the locked product decisions in [product-contract.md](./product-contract.md);
2. machine-readable JSON Schema for individual data shapes;
3. OpenAPI for HTTP operations and AsyncAPI for WebSocket operations/events;
4. WIT for the WASI guest/host boundary;
5. the topic's normative Markdown;
6. examples and review reports.

`SPEC-003` A detected disagreement MUST block implementation until the artifacts are reconciled.
Implementers MUST NOT silently select the more convenient interpretation.

## Schema conventions

- JSON uses UTF-8 and media type `application/json`.
- IDs are lowercase canonical UUIDv7 strings unless a schema explicitly declares an upstream ID.
- Timestamps are UTC RFC 3339 strings with millisecond precision on the wire and signed 64-bit Unix
  milliseconds in SQLite.
- Durations are integer milliseconds and use an `Ms` suffix in prose/types.
- Byte limits count encoded UTF-8 or binary frame bytes as applicable.
- Objects reject undeclared fields unless explicitly declared extensible.
- Optional means absent is valid; `null` is valid only when included in the schema.
- Enumeration values are lowercase kebab-case.
- Plugin-owned names use reverse-DNS plugin coordinates and a declared local name.

`SPEC-004` Every wire object MUST define field type, requiredness, bounds, default, sensitivity,
authorization relevance, versioning behavior, and unknown-field behavior.

`SPEC-005` Every mutation MUST define its authorization, idempotency, expected resource version,
timeout, cancellation, commit point, errors, emitted events, and retry safety.

`SPEC-006` Every event MUST define its producer, schema, authorization/redaction, commit point,
ordering, replay behavior, retention, and consumer recovery.

## Versioning

Major versions are incompatible. Minor capability additions are negotiated through descriptors and
MUST remain ignorable by older peers. Patch releases change implementation without changing a
schema.

`SPEC-007` A peer MUST fail closed when it cannot validate the negotiated major protocol, plugin
API, manifest, event, or renderer contract.

`SPEC-008` Unknown optional capabilities MAY be ignored. Unknown object fields, commands, event
versions, lifecycle transitions, or permission names MUST be rejected unless their schema declares
an extension point.

## Security and privacy notation

Every field is classified as one of:

- `public` — safe to disclose without pairing;
- `owner` — available to an authenticated owner Client;
- `sensitive` — permitted only for the operation and excluded from routine logs/caches;
- `secret` — write-only or broker-only, never returned as plaintext.

`SPEC-009` Examples MUST use synthetic identities, repositories, credentials, and payloads. They
MUST NOT contain copied production data or plausible live secrets.

`SPEC-010` Logs, audit records, events, errors, and diagnostics MUST use allowlisted fields and MUST
NOT include command bodies, prompts, terminal data, source contents, secret material, raw provider
responses, or authentication artifacts.

## Document requirements

Every normative Markdown file MUST state its status and requirement prefix. It SHOULD contain:

1. scope and ownership;
2. invariants;
3. concrete data or state definitions;
4. happy-path flow;
5. failure/recovery behavior;
6. security constraints; and
7. acceptance cases.

`SPEC-011` The final tree MUST contain no unfinished-work marker, open specification issue,
incomplete schema, or example standing in place of a required catalog.

`SPEC-012` Mermaid diagrams are informative visualizations. Their labels and flows MUST agree with
the surrounding normative prose.

## Implementation freedom

An implementation may choose internal modules, libraries, indexes, caches, and algorithms that do
not alter a normative observable property. References to the V1 source tree explain migration
context and do not require preserving V1 module placement.
