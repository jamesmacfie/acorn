# Acorn V2 specification final closure report

**Status:** Approved as implementation-ready specification<br>
**Closure date:** 2026-07-31<br>
**Closure owner:** Primary architecture review<br>
**Requirement prefix:** `REVIEW-FINAL`

## Decision

The Acorn V2 specification is approved for implementation. A development team can build the
distributed Node, Electron Fleet Client, plugin host and migrated default profile without choosing
a competing topology, ownership model, protocol, trust model, runtime tier, UI model, storage
boundary, lifecycle, migration policy or compatibility policy.

Approval means architecture and product policy are frozen. It does not claim the implementation
already passes platform security, parity, performance or release tests. Those gates remain
mandatory in the phased rewrite plan.

## Closure corpus

The final corpus contains:

- 207 files: 156 Markdown, 46 JSON, four YAML and one WIT artifact;
- normative product, architecture, transport, data, plugin, UI, UX, security, migration,
  repository and development-platform contracts;
- a closed core operation registry and current-plugin operation/payload catalogs;
- all twenty current-plugin target dossiers and exact coupling replacements;
- 100 frozen Herdr source rows and one materialized, cross-validated compatibility fixture set;
- OpenAPI, AsyncAPI, JSON Schema and WIT contracts plus positive/negative examples; and
- protocol, security, plugin/parity, Herdr and final cross-review records.

## Locked implementation decisions

`REVIEW-FINAL-001` The following are closed:

1. Electron is the V2 Client; Tauri is not a V2 deliverable.
2. `apps/node` builds the one Electron-free Node used both standalone and bundled by Electron.
3. Turborepo/pnpm use separate `apps/*`, `packages/*` and `plugins/*` roots with the dependency
   direction, contract-first task graph and artifact composition in `REPO-001`–`REPO-026`.
4. One Node owns many Workspaces; a Workspace belongs to exactly one Node; all resources are
   node-qualified.
5. Direct V2 uses TLS 1.3, post-enrollment mTLS and pinned Node identity. Pairing/recovery are the
   two transcript-authenticated pre-credential claim routes.
6. Every paired Client is full owner. Device pairing, rotation, revocation and recovery use
   high-friction ceremonies.
7. HTTPS/OpenAPI handles bounded requests; one authenticated AsyncAPI WebSocket per Node handles
   events and streams.
8. Commands are idempotent change requests; events are committed facts. Replay is at least once,
   retained for seven days or 256 MiB, followed by authorized snapshot recovery.
9. Plugin collaboration uses declared broker capabilities/events and preserves delegated caller
   authority. Direct imports, private endpoints, cross-plugin SQL and ambient credentials are
   prohibited.
10. Declarative, WASI Component, sandboxed native and in-process System runtimes are distinct.
    Native requires Verified provenance and enforceable OS sandbox; unsandboxed Developer Source
    is disclosed unrestricted local execution.
11. Declarative UI is semantic and script-free. Bespoke UI is independently acquired, signed,
    origin-isolated and restricted to a typed revocable view-session bridge.
12. Core and per-plugin SQLite are isolated. Secrets/sensitive fields/backups use application
    encryption; general durable data requires OS full-disk encryption.
13. Installation, permission, setup, health, update, rollback, quarantine, uninstall, retention and
    reinstall are persisted, coordinated state machines.
14. V2 is a clean start. Only workspace/repository configuration may be imported. V1 data remains
    untouched, V1 tokens are invalid and `/api/v1` has no bridge.
15. GitHub, Terminal and Agents are System plugins. The other current features are separately
    packaged Verified plugins in the default profile, with the fixed classifications and splits.
16. Fresh-install desktop visual/behavioral parity is mandatory; Fleet, pairing and plugin
    management are additive.
17. Relay and mobile are contract-constrained future consumers, not V2 deliverables.
18. Implementation starts with deterministic contract tooling and a local/remote vertical slice,
    hardens security boundaries before plugin extraction, then extracts Terminal, GitHub, Agents
    and dependency-layered Verified plugins.
19. Every release gate and plugin parity result is bound to immutable tested artifact digests;
    signing does not rebuild the candidate.

## Review finding closure

| Review | Initial blocking findings | Resolution | Verification |
| --- | ---: | --- | --- |
| Security red team | 3 Critical, 11 High, 1 Medium | pairing, bootstrap, authorization, secret, sandbox, UI, supply-chain, backup and incident contracts corrected | security report §9: all verified closed |
| Plugin/parity | 8 High, 2 Medium | contribution/renderer/worker/lifecycle/build contracts, runtime classifications, operation payloads, V1 ledger and parity fixed | `REVIEW-PPH-FINAL-001` |
| Herdr escape review | 9 findings | materialized 100-row contracts, capability families, workers, builds, bespoke UI, lifecycle and semantic operation payloads | `REVIEW-HERDR-FINAL-001` plus `PASS-017` |
| Protocol/schema | 9 closure findings | fingerprint, pre-credential TLS, time bounds, command-result union, subscription filters, events, lifecycle, artifacts and operations aligned | `REVIEW-PROTO-FINAL-001` |
| Final cross-review | no new Critical/High | links, counts, terminology, review status, manifests and semantic fixtures rechecked | this report |

No Critical, High or Medium specification finding remains open or accepted as residual product
risk.

## Machine and corpus validation

`REVIEW-FINAL-002` Closure validation records:

- every JSON and YAML documentation artifact parses;
- every JSON Schema compiles under strict Draft 2020-12 validation with formats;
- positive JSON, current-manifest and contribution fixtures validate;
- all named negative fixtures reject;
- every OpenAPI/AsyncAPI local and external reference resolves;
- all 100 Herdr rows, 449 operations, 898 operation schemas, schema digests, permissions,
  contributions, streams, workers and events cross-validate;
- Herdr result contracts distinguish pane-query, stream-command, settled-command and local
  presentation outcomes; no status-only result placeholder remains;
- current declarative-only fixtures carry no inherited WASI artifact;
- every local Markdown link resolves;
- no empty file or unfinished-authoring marker remains; and
- the specification directory alone changed during this programme.

`REVIEW-FINAL-003` The implementation MUST reproduce these checks in repository CI. The
documentation-time commands are evidence, not a permanent substitute for versioned validation
tasks.

## Implementation entry point

The implementation entry point is
[build and implementation sequencing](../migration/build-and-implementation-sequencing.md), not an
independent interpretation of the architecture. The mandatory order is:

1. build the pinned validation/generation toolchain and prove deterministic generated bindings;
2. create the canonical workspace and artifact skeleton;
3. deliver one complete bundled/remote Node vertical slice with declarative and WASI conformance
   plugins;
4. complete lifecycle/UI/credential/native hosts and the real-boundary security harness;
5. extract Terminal, GitHub and Agents individually in that order;
6. extract Verified plugins in the dependency waves defined by `BUILD-SEQ-013`;
7. attach per-plugin and default-profile parity bundles to the tested artifact digests; and
8. assemble, sign and publish that same candidate only after `G5`.

`REVIEW-FINAL-004` A generated binding or implementation inconvenience does not authorize a contract
change. Any required choice named by `TRACE-011` returns to specification review with a versioning
decision before merge.

## Implementation-only residual risks

These are expected engineering risks, not unresolved specification policy:

- OS keystore, filesystem confinement, PTY/process supervision and native sandbox behavior differ
  by platform and require real boundary tests.
- Cryptographic transcript, certificate, backup and recovery implementations require test vectors,
  fuzzing and independent security review.
- WASI/WIT bindings and component engines require pinned toolchains and denial tests for every
  unavailable host authority.
- Exact renderer parity, accessibility, keyboard behavior and performance require screenshot,
  assistive-technology and workload evidence.
- Provider APIs and external CLIs evolve; adapters must remain behind versioned, normalized
  contracts and health/quarantine behavior.
- Schema generation from the normative field catalogs must be deterministic at G0A and its digest
  must remain stable through the dependent release evidence.

None permits changing the architecture silently. Failure to satisfy one blocks the relevant phase
or release.

## Final acceptance

**`REVIEW-FINAL-005`:** The documentation satisfies the vNext specification programme's closure
criteria. It is sufficiently complete to assign the rebuild to a development team. Implementation
may begin at Gate G0A, and V2 may ship only after the executable acceptance and
platform-conformance evidence in `ACCEPT-MIG-020`–`ACCEPT-MIG-066` passes.
