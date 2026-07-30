# Phased rewrite and release plan

**Status:** Normative implementation sequence<br>
**Requirement prefix:** `MIG`

The rewrite proceeds through conformance gates. A phase may be developed in parallel, but a later
runtime behavior MUST NOT become the default before the preceding gate passes.

The detailed task graph, wave ordering, permitted parallelism and evidence ownership are normative
in [build and implementation sequencing](./build-and-implementation-sequencing.md). This document
defines the release phases; the sequencing document defines how a team reaches each phase gate.

## Repository and build-graph prerequisite

During Phase 0, after contract-toolchain Gate G0A and before product runtime work, establish the
normative workspace in
[repository and workspace structure](../development/repository-and-workspace-structure.md):

- `apps/desktop` owns the Electron Client and desktop distribution;
- `apps/node` owns the only production Node implementation and standalone distribution;
- `packages/` contains only the named platform contracts, SDKs, test kits, and justified reusable
  libraries; and
- `plugins/` contains one workspace package for every first-party plugin, including System plugins.

`MIG-083` The repository migration MUST preserve a working product while moving the current
Electron-owned service graph into `apps/node`. Electron may supervise the new Node build as soon as
its protocol boundary works; it MUST NOT retain a fallback production service implementation.

`MIG-084` Desktop packaging MUST consume the exact standalone Node build output by digest.
Application source imports, duplicated entrypoints, and local-only Node forks are migration
failures.

`MIG-085` First-party plugin extraction MUST move one logical plugin at a time into `plugins/<name>`
without changing its coordinate or splitting its Node/client artifacts into independently
versioned workspace packages.

`MIG-086` A feature helper is moved to `packages/` only when the extraction identifies its platform
owner, stable public contract, and at least one legitimate consumer outside the original feature.
Otherwise it remains feature-owned.

Gate G0B: workspace boundary tests pass, both application packages build independently, Electron
operates the standalone Node artifact, and a single-plugin external repository validates using the
same SDK without Turborepo.

## Phase 0 — contract toolchain and workspace closure

- Implement pinned repository tasks for OpenAPI, AsyncAPI, JSON Schema, WIT, manifest, example,
  link and requirement-identifier validation.
- Generate protocol, UI, capability and WIT bindings plus immutable schema bundles
  deterministically.
- Record a golden generated-surface digest; reject stale generation and parallel hand-written wire
  types.
- Establish the `apps/*`, `packages/*` and `plugins/*` skeleton, boundary tests, artifact assembly
  graph and external-plugin fixture.
- Close critical/high adversarial findings, complete current-plugin/Herdr mappings and freeze the
  V2.0 contract sources.

`MIG-080` No product implementation branch may define a competing wire shape outside the versioned
contract artifacts.

`MIG-087` Runtime feature work MUST NOT pass Phase 0 until clean-checkout generation is
byte-for-byte deterministic on every supported build platform and all documentation-time
validation is executable in CI.

Gate: `G0A` and `G0B` in the sequencing contract pass.

## Phase 1 — distributed vertical slice

- Establish the one Electron-free Node composition root.
- Implement Node identity, local CA, pairing, mTLS, descriptors, `/v2` query/command API, event
  outbox, replay-gap snapshot resynchronization, command idempotency and isolated data root.
- Implement Electron Fleet store, one connection per Node, node-qualified resource cache, local
  Node supervision, and connection health.
- Prove one query/command/event/patch declarative view and one permissioned Community WASI
  conformance plugin, including lifecycle and storage.
- Exercise cancellation, timeout, optimistic concurrency, stale/offline and restart paths.

Gate: `G1` passes with one Electron Client concurrently operating a bundled Node and at least one
direct remote Node through the same protocol.

## Phase 2 — complete plugin host, semantic UI and security harness

- Implement manifests, artifact verification, dependency resolution, capability broker, core and
  per-plugin storage, lifecycle state machines, settings/wizard host, and audit.
- Implement declarative UI/view sessions and the built-in renderer catalog.
- Implement bespoke UI isolation and locally verified Client artifacts.
- Implement WASI hosting before enabling Community executable plugins.
- Implement the credential broker and enforce native-process sandbox support.
- Run hostile fixtures at real filesystem, network, process, credential and browser-origin
  boundaries, including pairing/revocation, path/symlink, SSRF, deputy, event, archive/build,
  secret, backup and bespoke-UI attacks.

Gate: `G2` passes; hostile conformance plugins cannot escape declared authority; artifact
install/update/rollback passes crash and tamper cases; every persisted lifecycle transition
reconciles after restart.

## Phase 3 — System plugins in dependency order

1. Extract Terminal after moving generic worktree/process/file/config-trust/execution policy into
   core brokers.
2. Extract GitHub after separating provider identity from Acorn identity and stabilizing brokered
   provider/Git/read-model services.
3. Extract Agents after Terminal execution and agent/provider/renderer contracts are stable.
4. Replace every System-plugin import from core with contributions and capabilities.

`MIG-088` Each System plugin MUST pass its individual contract, security, restart and parity gate
before extraction of the next System plugin is treated as complete.

Gate: `G3A`, `G3B` and `G3C` pass; System plugins produce full V1 parity with zero unapproved
boundary exemptions.

## Phase 4 — Verified first-party plugins by dependency layer

- Extract Editor/Changes; Notes/Memory/Context; Model Providers/profiles/Workflows;
  Preview/Docker/HTTP/Database; Linear/Rollbar; then Onboarding, in that order.
- Assign each plugin its own storage and migrations.
- Remove every cross-plugin import in the coupling map.
- Define the default installation profile and offline seed artifacts.

`MIG-089` A plugin enters the default profile only after its individual artifact, install, setup,
operation, UI, failure, update, uninstall/reinstall, security and parity evidence is attached to
the tested artifact digest.

Gate: `G4` passes; all twenty plugin parity suites pass individually and as the fresh-install
default profile.

## Phase 5 — clean-start release candidate

- Enable V1 configuration discovery and the read-only importer.
- Enable plugin marketplace metadata/update/quarantine.
- Verify `/api/v1` is absent.
- Run local/remote, offline, cursor-expiry, backup/restore, lost-device, compromised-plugin, and
  fresh-install parity exercises.
- Assemble the release candidate from the artifact digests already used by contract, integration,
  security and parity jobs. Do not rebuild after evidence collection.

Gate: `G5` passes; final closure report contains no open critical/high finding and all medium
findings are fixed or accepted explicitly.

## Phase 6 — V2 release

- Ship Electron, standalone Node distribution, system plugins, default Verified profile, and signed
  marketplace metadata.
- Preserve the V1 application/data root for owner-controlled fallback.
- Monitor privacy-safe health, crash-loop quarantine, pairing failures, update rollback, and
  renderer-capability mismatch.

`MIG-081` A release rollback MUST switch distribution metadata to the last known-good immutable
artifacts. It MUST NOT rewrite a Node database with older binaries unless that version declares and
passes downgrade compatibility.

`MIG-082` Relay and mobile implementation work begins only after the V2 direct protocol is stable.
It MUST NOT alter V2 resource identity, semantic UI, or end-to-end security assumptions.
