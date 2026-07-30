# Build and implementation sequencing

**Status:** Normative delivery programme<br>
**Requirement prefix:** `BUILD-SEQ`

This document fixes the order in which Acorn V2 is built. It complements the architectural phases
in [phased rewrite and release plan](./phased-rewrite-and-release-plan.md) with executable build
gates, dependency ordering, evidence ownership and permitted parallelism. A team may divide work
inside an open wave, but it MUST NOT bypass a gate or create a temporary competing protocol,
storage owner, Node implementation or plugin boundary.

## Sequencing invariants

`BUILD-SEQ-001` V1 remains buildable and operational while V2 is developed. V2 uses separate
entrypoints, distributions and data roots. No V2 migration step may write V1 state.

`BUILD-SEQ-002` `apps/node` is the only V2 production Node from its first executable milestone.
Electron supervises that exact build artifact locally and uses the same wire protocol for local and
remote Nodes. A temporary Electron-only production Node, compatibility bridge or duplicated domain
implementation is prohibited.

`BUILD-SEQ-003` Contract tooling precedes product behavior. Runtime code MUST consume generated
bindings or validated schema artifacts derived from the normative OpenAPI, AsyncAPI, JSON Schema,
WIT and manifest sources. Hand-written parallel wire types are prohibited.

`BUILD-SEQ-004` Extraction follows a working vertical slice. Current plugins MUST NOT be moved
wholesale into new packages before identity, commands, events, storage, capability brokering and
Client connection behavior have been exercised end to end.

`BUILD-SEQ-005` Every wave ends with durable evidence. A later wave cannot infer that an earlier
gate passed from source review alone.

## Turborepo build pipeline

The root task graph is the executable expression of the architecture. Package scripts may use
different implementation tools, but these task names and dependency meanings are stable:

| Order | Root task | Required output |
| ---: | --- | --- |
| 0 | `toolchain:verify` | pinned Node, pnpm, Turbo, schema validators, WIT parser/bindgen, WASI component toolchain and platform prerequisites |
| 1 | `contracts:validate` | parsed and semantically cross-checked OpenAPI, AsyncAPI, JSON Schema, WIT, manifests, examples, links and unique requirement identifiers |
| 2 | `contracts:generate` | deterministic protocol bindings, schema bundles, SDK surfaces and a digest manifest |
| 3 | `contracts:check-generated` | a clean second generation with identical bytes/digests and no hand-maintained competing wire declarations |
| 4 | `lint`, `typecheck`, `test:unit` | package-local static and unit evidence |
| 5 | `build` | application, platform-package and plugin intermediate artifacts |
| 6 | `artifact:assemble` | immutable Node, Electron, plugin, schema, SBOM and provenance candidate artifacts |
| 7 | `artifact:verify` | digest, signature-input, lock, archive-safety, dependency, platform and compatibility validation |
| 8 | `test:contract`, `test:integration`, `test:security` | wire, cross-process, authority-denial, restart and fault evidence |
| 9 | `test:parity` | per-plugin and default-profile parity evidence bundles |
| 10 | `dist` | unsigned distributable candidates composed only from verified artifacts |
| 11 | `release:sign` | non-cached signing, notarization where applicable, transparency/provenance publication inputs |

`BUILD-SEQ-006` `build` depends on `contracts:check-generated`; it cannot silently regenerate
contracts with a different tool version. Application and plugin builds depend on the build outputs
of their declared platform-package dependencies. `apps/desktop#artifact:assemble` depends on
`apps/node#artifact:verify` and embeds the exact verified Node digest.

`BUILD-SEQ-007` Canonical contract sources and a golden generated-surface digest manifest are
committed. Generated language bindings and distributable schema bundles are deterministic build
outputs, not hand-edited sources and not committed workspace state. Bootstrap and CI regenerate
them; release assembly records their digests.

`BUILD-SEQ-008` Turbo remote/local cache entries may contain only deterministic, non-secret
outputs. Tests that exercise local data roots MUST use disposable paths. Signing, notarization,
Developer Source builds, secret-bearing provider tests and any task whose result depends on a
credential MUST be non-cacheable.

`BUILD-SEQ-009` Release jobs MUST consume the same `artifact:verify` outputs already exercised by
integration, security and parity jobs. They MUST NOT rebuild an untested binary after evidence has
been collected.

`BUILD-SEQ-010` CI MUST publish a machine-readable evidence index relating source revision,
toolchain lock, contract digests, application/plugin artifact digests, test run, platform and
signing/provenance result. Failed, cancelled or stale evidence cannot satisfy a gate.

## Wave 0A — contract toolchain

Build the validation/generation packages and CI gates before product runtime work:

1. pin validators for OpenAPI 3.1, AsyncAPI 3.0, Draft 2020-12 JSON Schema and WIT;
2. validate every positive and negative example, the 20 current manifests and Herdr semantic
   fixtures;
3. implement reference resolution, link validation and unique requirement-ID checks;
4. generate TypeScript protocol/UI/capability bindings and WIT host/guest bindings;
5. generate immutable schema bundles and the golden digest manifest; and
6. reject non-generated wire declarations at package boundaries.

**Gate G0A:** clean checkout generation is byte-for-byte deterministic on each supported build
platform; all current documentation-time contract checks run as repository tasks; malformed
contracts and stale generated-surface digests fail CI.

## Wave 0B — workspace and artifact skeleton

Create the canonical `apps/`, `packages/` and `plugins/` workspace roots, package boundary tests and
artifact assembly skeleton described by
[repository and workspace structure](../development/repository-and-workspace-structure.md).
Initially, plugin packages may contain only manifests, contracts, tests and migration inventories;
behavior remains in the working V1 tree until its extraction wave.

**Gate G0B:** both application composition roots build independently; a bootstrap standalone Node
artifact exposing only descriptor/health behavior is embedded by digest into Electron; all 20
logical plugin coordinates resolve; and an external single-plugin fixture builds and validates
without Turborepo.

## Wave 1 — one complete distributed vertical slice

Implement the smallest slice that proves every irreversible boundary:

- Node identity, local trust bootstrap, remote pairing, mTLS reconnect and revocation;
- core SQLite ownership, command idempotency, transactional outbox, ordered events, replay-gap
  snapshot recovery and Node-qualified resource cache;
- one Electron Fleet connection to the bundled Node and one to a directly reachable remote Node;
- one bounded declarative view session with query, command, event subscription and patch behavior;
- one minimal Community WASI plugin using a granted broker capability and isolated durable state;
- install, permission, setup, health, disable, update simulation and uninstall state transitions;
  and
- stale/offline, cancellation, timeout, optimistic-concurrency and restart reconciliation paths.

The declarative and WASI fixtures are conformance plugins, not migrated product features. They
remain in the test kit after the slice is complete.

**Gate G1:** the same Client concurrently operates local and remote workspaces; a committed command
is observed through replayable events; an expired cursor recovers from snapshot; undeclared WASI
authority is denied; and every resource, cache key, audit entry and action remains Node-qualified.

## Wave 2 — host completion and security harness

Complete the platform before extracting privileged System plugins:

- capability/delegation broker, custom-event broker, stream controls and saga support;
- per-plugin database/migration/backup/quota lifecycle;
- complete artifact acquisition, verification, coordinated Node/Client activation, rollback,
  quarantine, retention and reinstall;
- complete renderer catalog, settings and wizard hosts, bespoke UI origin/bridge sandbox and
  declarative fallback handling;
- secret broker, credential-purpose/destination binding and privacy-safe audit;
- native-process sandbox enforcement for every supported OS; and
- malicious fixtures for pairing/revocation, path traversal, symlink races, SSRF, confused deputy,
  event spoof/replay, secret leakage, archive/build attacks, backup theft and bespoke UI escape.

`BUILD-SEQ-011` Security harnesses MUST run at the actual process, filesystem, network, credential
and browser-origin boundaries. A mocked permission check is not evidence of sandbox denial.

**Gate G2:** all Critical/High security conformance cases pass on the implementation's supported
platforms; unsupported native-sandbox platforms fail installation closed; crash/restart testing
reconciles every persisted lifecycle state.

## Wave 3 — System plugins, one at a time

System extraction is deliberately ordered:

### Wave 3A — Terminal and execution primitives

Move generic process, PTY, filesystem, worktree, repository-configuration trust and execution
policy into Node core brokers. Then package Terminal as the System consumer of those brokers.

**Gate G3A:** Terminal parity passes with no generic execution primitive owned by the plugin and no
Electron-only Node fork.

### Wave 3B — GitHub and provider identity

Separate Acorn device/Node identity from GitHub identity; establish provider secret brokering,
Git/read-model/blob services and review operations; then package GitHub without Linear ownership.

**Gate G3B:** GitHub review parity, offline read behavior, credential non-disclosure and provider
identity switching pass against local and remote Nodes.

### Wave 3C — Agents

Implement agent runtime/profile contracts, requests, approvals, transcript/tool rendering,
artifacts, status/attention and terminal handoff on the stable execution and renderer capabilities;
then package Agents.

**Gate G3C:** Agents parity passes across restart, reconnect, cancellation, approval and delegated
tool authority. All three System plugins have zero unapproved cross-feature boundary exemptions.

`BUILD-SEQ-012` A System plugin extraction PR MUST include its manifest/contracts, operation and
event implementation, storage ownership, host contributions, removed coupling edges, security
tests and complete parity evidence. Moving files without replacing their ambient authority is not
extraction.

## Wave 4 — Verified plugins by dependency layer

Verified extraction follows consumer dependencies so no plugin imports a temporary implementation:

| Wave | Plugins | Prerequisite and purpose |
| --- | --- | --- |
| 4A | Editor, Changes | standard editor/file/search/diff renderer capabilities and core Git consumers |
| 4B | Notes, Memory, Context | independent Notes/Memory services followed by typed context-section composition |
| 4C | Model Providers, Aider, Claude, Codex, Workflows | brokered model/CLI profiles and workflow ownership on stable Agents/Terminal contracts |
| 4D | Preview, Docker, HTTP, Database | Node companions, browser renderer and brokered local/integration services |
| 4E | Linear, Rollbar | optional marketplace integration patterns, credentials, polling/events and health |
| 4F | Onboarding | final default-profile orchestration after all setup/settings contracts are stable |

`BUILD-SEQ-013` Plugins within a wave may be implemented in parallel only when their declared
contracts are frozen and they do not consume one another. Where the table implies a producer then
consumer—especially Notes/Memory before Context and profiles before workflow use—the producer gate
passes first.

**Gate G4:** each plugin passes its individual install, setup, operation, UI, failure, update,
uninstall/reinstall and parity suite before it joins the default profile. The full default profile
then passes from a fresh data root with signed offline-seed artifacts.

## Wave 5 — release candidate and cutover

Only after G4:

1. enable the read-only V1 workspace/repository configuration importer;
2. prove V1 root immutability and `/api/v1` absence;
3. run local/remote/offline/replay-expiry/lost-device/backup/restore/quarantine scenarios;
4. run supported-platform performance, accessibility and native-boundary suites;
5. assemble unsigned distributions from previously verified artifacts;
6. complete independent security and parity review; and
7. sign/notarize/publish only the exact candidate that passed.

**Gate G5:** every case in
[parity and cutover acceptance](./parity-and-cutover-acceptance.md) has an evidence bundle; there is
no Critical/High finding; any Medium is an explicit time-bounded accepted risk; release rollback
metadata points to immutable last-known-good artifacts.

## Permitted parallelism and merge order

`BUILD-SEQ-014` Work may proceed in parallel inside these boundaries:

- Electron shell and Node spine after G0A/G0B, against the same generated contracts;
- declarative renderer and WASI host fixtures during Wave 1;
- lifecycle, artifact and security harness components during Wave 2, with shared state-machine
  tests controlling merge;
- independent plugins inside an eligible Wave 4 row; and
- platform-specific conformance runs against one candidate digest.

`BUILD-SEQ-015` The merge order for a new or changed cross-boundary operation is: normative
contract and compatibility decision; generated binding/digest update; producer implementation;
consumer implementation; contract/security/parity evidence; artifact assembly. A consumer MUST NOT
merge a private temporary endpoint or direct import while waiting for the producer.

`BUILD-SEQ-016` Feature flags may hide a complete V2 slice from ordinary users while it matures.
They MUST NOT select between competing data owners or wire contracts for the same V2 resource.

## Gate evidence and ownership

Every gate evidence index records:

- source revision and clean/dirty state;
- toolchain lock and contract/generated-surface digests;
- package and final artifact digests;
- platform, architecture and test environment;
- exact tests, result and retained logs/artifacts with secret redaction;
- reviewer, time, expiry/staleness rule and linked finding disposition; and
- approval for the next wave.

`BUILD-SEQ-017` Gate owners are accountable for evidence, not merely task completion. Architecture
owns G0A/G0B, the Node/Client leads jointly own G1, Security owns G2, each plugin owner and parity
reviewer jointly own G3/G4, and Release owns G5 after independent review.

`BUILD-SEQ-018` A change to a closed contract, generated surface, trust boundary, data owner or
artifact digest invalidates dependent evidence back to the earliest affected gate. Cosmetic
documentation changes do not invalidate binary evidence but still run corpus validation.
