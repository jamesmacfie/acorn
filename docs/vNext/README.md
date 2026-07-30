# Acorn vNext specification

**Status:** Normative specification programme<br>
**Requirement prefix:** `VNEXT`<br>
**Target:** Acorn V2 distributed Node and Electron client<br>
**Compatibility:** Clean-start release; Acorn V1 remains untouched

This tree is the implementation contract for Acorn V2. It replaces the local, statically composed
runtime with an Electron-free **Acorn Node**, an independently installed **Electron Client**, and a
runtime plugin system. The first release supports a bundled local Node and directly reachable remote
Nodes. Relay transport and mobile clients are constrained here so V2 does not close those paths, but
neither is a V2 deliverable.

The specification is deliberately self-contained. Existing documents under `docs/` describe Acorn
V1 and do not override a requirement here. When two vNext documents appear to disagree, the
precedence rules in [normative-conventions.md](./normative-conventions.md) apply and the disagreement
is a release-blocking documentation defect.

## Start here

1. [Product contract](./product-contract.md) — the required product outcome and non-goals.
2. [Decision ledger](./decision-ledger.md) — locked architectural and product choices.
3. [System overview](./architecture/system-overview.md) — Node, Client, Fleet, and plugin topology.
4. [Protocol contracts](./contracts/README.md) — portable HTTP, event, schema, and WASI contracts.
5. [Plugin model](./plugins/plugin-model.md) — packaging, trust, lifecycle, and collaboration.
6. [UI contribution model](./ui/ui-contribution-model.md) — built-in and bespoke UI behavior.
7. [Threat model](./security/threat-model.md) — assets, adversaries, boundaries, and residual risks.
8. [Current plugins](./current-plugins/README.md) — migration specification for every V1 plugin.
9. [Traceability](./requirements-and-traceability.md) — coverage and completion rules.
10. [Repository structure](./development/repository-and-workspace-structure.md) — Turborepo roots,
    package roles, dependency direction, and external plugin source layout.
11. [Build and implementation sequencing](./migration/build-and-implementation-sequencing.md) —
    contract-first tasks, vertical slice, security harness, extraction waves and artifact-bound
    release gates.

## Normative map

| Area | Contents |
| --- | --- |
| `architecture/` | System boundaries, topology, ownership, negotiation, and degraded operation |
| `contracts/` | OpenAPI, AsyncAPI, JSON Schema, WIT, examples, and wire semantics |
| `data/` | Core and plugin persistence, client cache, events, backups, and sagas |
| `plugins/` | Manifests, runtimes, trust, capabilities, collaboration, and lifecycle |
| `ui/` | Contribution surfaces, renderer catalog, stateful views, and bespoke UI |
| `ux/` | First run, pairing, fleet navigation, installation, recovery, and parity |
| `security/` | Threat model, identity, encryption, isolation, supply chain, and conformance |
| `current-plugins/` | Exact V1-to-V2 disposition for all twenty in-tree plugins |
| `examples/` | Herdr coverage and end-to-end community plugin examples |
| `migration/` | Clean-start boundary, API replacement, implementation sequence, and cutover |
| `development/` | Normative repository/workspace structure plus brief authoring and future Plugin Studio requirements |
| `reviews/` | Adversarial findings, resolutions, and final closure evidence |

## Fixed release properties

- Electron is the V2 client. Tauri is not part of V2.
- A Node is Electron-free and owns execution and durable product state.
- One Node owns many workspaces; a workspace belongs to exactly one Node.
- Every paired client has full owner authority. There are no viewer/operator roles in V2.
- The Client presents one fleet shell while preserving node-qualified resource ownership.
- GitHub, Terminal, and Agents are system plugins.
- Other shipped features are independently packaged Acorn Verified plugins and form the default
  installation profile.
- Community executable plugins use WASI Components. Native plugins require enforceable OS
  sandboxing; unsandboxed native code is Developer Source and unrestricted local code execution.
- Nodes and plugins have isolated SQLite databases. Cross-plugin SQL is prohibited.
- Credentials, sensitive fields, transport, and backups use application encryption. General data
  relies on mandatory OS full-disk encryption.
- Event replay ends when either seven days or 256 MiB is reached. Clients recover from a current
  snapshot when their cursor has expired.
- V2 does not import V1 operational data and does not preserve `/api/v1`.
- A fresh V2 desktop preserves V1 visual and behavioral product parity, with fleet, pairing, and
  plugin-management surfaces added.

## Completion rule

This tree is complete only when [reviews/final-closure-report.md](./reviews/final-closure-report.md)
records that all normative artifacts parse, all requirements are traceable, all twenty current
plugins and the Herdr top-100 corpus are covered, and all critical/high review findings are closed.
