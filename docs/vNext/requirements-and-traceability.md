# Requirements and traceability

**Status:** Normative completion contract<br>
**Requirement prefix:** `TRACE`

## Stable requirement families

| Prefix | Area |
| --- | --- |
| `PROD` / `DEC` / `SPEC` | Product, decisions, and specification rules |
| `ARCH` | Architecture and runtime boundaries |
| `CON` | Transport, resources, commands, events, streams, and schemas |
| `DATA` | Core/plugin/client persistence, outbox, backup, and recovery |
| `PLUG` | Plugin packaging, trust, permissions, lifecycle, and collaboration |
| `UI` / `UX` | Semantic/bespoke UI and owner workflows |
| `SEC` / `THREAT` | Security controls, threats, and residual risk |
| `CUR` | Current-plugin migration and parity |
| `MIG` / `BUILD-SEQ` | Clean start, API removal, implementation phases, build gates, and cutover |
| `REPO` / `PLUG-DEV` | Turborepo workspace roles, source packages, build graph, and plugin authoring |
| `HERDR` / `EX` | Herdr coverage and end-to-end examples |
| `ACCEPT` | Executable or manually verifiable acceptance condition |

`TRACE-001` Identifiers MUST be globally unique and MUST NOT be renumbered after another document
references them. Superseded requirements remain in the decision history with a replacement link.

## Required coverage matrices

The final documentation MUST maintain the following matrices:

1. locked decision to normative requirements and machine-readable artifacts;
2. HTTP/stream operation to authentication, permission, errors, events, and tests;
3. event to producer, payload schema, retention, redaction, and recovery;
4. plugin manifest declaration to lifecycle validation and host enforcement;
5. renderer/contribution to Electron behavior, accessibility, and fallback;
6. threat to mitigation, conformance test, residual risk, and incident response;
7. every V1 route, event, table, UI contribution, and coupling edge to its V2 owner;
8. all twenty V1 plugins to manifest, Node/Client split, data, lifecycle, and parity;
9. all one hundred Herdr plugins to V2 capability or explicit unsupported decision; and
10. release acceptance case to required evidence;
11. implementation wave to prerequisite, permitted parallelism, gate owner and invalidated
    downstream evidence; and
12. tested application/plugin artifact digest to contract, security, parity and release evidence.

`TRACE-002` A matrix cell MUST contain an identifier or an explicit `not-applicable` rationale. Empty
cells are specification defects.

## Current-plugin completion

The required plugin set is:

`agents`, `changes`, `context`, `database`, `docker`, `editor`, `github`, `http`, `linear`,
`memory`, `model-providers`, `notes`, `onboarding`, `preview`, `profiles-aider`,
`profiles-claude`, `profiles-codex`, `rollbar`, `terminal`, and `workflows`.

`TRACE-003` Each plugin MUST document current authority, current data, current UI/routes/events,
target trust/runtime, Node/Client split, capabilities, dependencies, storage, settings/setup,
lifecycle, security, coupling removal, clean-start behavior, and parity acceptance.

`TRACE-004` The six complex plugins (`agents`, `editor`, `github`, `preview`, `terminal`,
`workflows`) MUST use multi-file specifications so their Node, Client, protocol, security, and
parity contracts can be reviewed independently.

## Machine-readable agreement

`TRACE-005` Every positive JSON example MUST validate against its declared JSON Schema. Every
explicit `.invalid.json` conformance vector MUST be rejected by its declared schema for its
documented reason and for no unrelated shape defect.

`TRACE-006` Every HTTP path and shape described in Markdown MUST agree with OpenAPI. Every event and
WebSocket frame MUST agree with AsyncAPI and its referenced JSON Schema. Every WASI import/export
MUST agree with WIT.

`TRACE-007` Schema parsing alone is insufficient: reviewers MUST compare defaults, limits,
authorization, error semantics, sensitivity, and version behavior across prose and artifacts.

`TRACE-007A` Node-core operations are closed by
[`contracts/core-operation-registry.md`](./contracts/core-operation-registry.md). Current-plugin
operation semantics and fields are jointly closed by the operation contract and payload catalogs.
Release schema generation is mechanical: it MUST NOT add fields, alter defaults, replace a named
record with an unbounded map or omit a catalog operation.

## Review closure

`TRACE-008` Critical and high findings block closure. Medium findings require correction or an
explicit accepted-risk entry with owner and rationale. Low findings may remain only when recorded.

`TRACE-009` Reviewers MUST verify fixes rather than accepting author assertion. The final closure
report records the finding ID, severity, affected requirements, resolution, verifier, and result.

`TRACE-010` Completion requires zero occurrences of unfinished-work markers, unresolved planning
language, deferred decisions, or incomplete machine-readable schemas.

## Definition of implementation-ready

A development team can begin only when it need not choose:

- Node/Client/Fleet ownership or topology;
- identity, transport, pairing, authorization, and revocation;
- resource IDs, protocol envelopes, errors, events, streams, or replay;
- core/plugin/client persistence and migration ownership;
- repository roots, application/package/plugin classification, build-artifact composition, or
  source dependency direction;
- contract-generation ownership, Turborepo task ordering, implementation-wave ordering,
  gate evidence or release-candidate provenance;
- plugin package, runtime, trust, dependency, permission, lifecycle, or update behavior;
- built-in renderer, declarative UI, bespoke UI, settings, or wizard behavior;
- credential, encryption, supply-chain, backup, audit, or incident policy;
- V1 import/API compatibility behavior; or
- target behavior for any current plugin.

`TRACE-011` If an implementer encounters such a choice, the documentation is incomplete and the
choice MUST return to specification review before code is merged.
