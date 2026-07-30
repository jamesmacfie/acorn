# Repository and workspace structure

**Status:** Normative implementation structure<br>
**Requirement prefix:** `REPO`

This document fixes the source-repository, package-graph, and build-artifact boundaries for Acorn
V2. The directory names describe architectural roles; they are not a statement about whether a
unit happens to contain executable code. Turborepo orchestrates the workspace and task graph, while
pnpm owns workspace package discovery.

## Classification rule

| Root | Contains | Dependency-graph role | Does not contain |
| --- | --- | --- | --- |
| `apps/` | independently runnable, distributable, or deployed Acorn products and services | terminal composition/build nodes | reusable libraries or hosted plugin implementations disguised as applications |
| `packages/` | non-deployable platform contracts, SDKs, test kits, and genuinely reusable libraries/tooling | dependencies of applications and plugins | feature ownership, plugin implementations, or a generic shared-code dumping ground |
| `plugins/` | one workspace package per logical first-party Acorn plugin release | hosted extension products built into signed plugin artifacts | independently deployed services or libraries imported directly by another plugin |

`REPO-001` The V2 workspace MUST declare `apps/*`, `packages/*`, and `plugins/*` as separate
workspace roots. A plugin MUST NOT be placed under `apps/` merely because it contains WASI,
native-process, system, worker, or bespoke-UI executable code.

`REPO-002` A source repository being independently cloneable or publishable does not make its
plugin an application. The classification is determined by deployment and hosting: an application
runs independently; a plugin is acquired, verified, installed, and hosted by Acorn.

`REPO-003` `packages/` MUST contain only stable platform boundaries or code with a real reusable
consumer contract. Feature-owned helpers remain inside their owning application or plugin.
Extraction solely to make a file appear shared is prohibited.

## Canonical V2 workspace

The minimum first-party workspace is:

```text
apps/
├── desktop/                   @acorn/desktop
└── node/                      @acorn/node

packages/
├── protocol/                  @acorn/protocol
├── plugin-sdk/                @acorn/plugin-sdk
├── plugin-testkit/            @acorn/plugin-testkit
├── plugin-manifest/           @acorn/plugin-manifest
├── ui-contracts/              @acorn/ui-contracts
└── capability-contracts/      @acorn/capability-contracts

plugins/
├── agents/                    @acorn/plugin-agents
├── github/                    @acorn/plugin-github
├── terminal/                  @acorn/plugin-terminal
├── editor/                    @acorn/plugin-editor
└── <remaining-first-party-plugin>/
```

`REPO-004` `apps/desktop` is the Electron Client and desktop distribution composition root.
`apps/node` is the single Electron-free standalone Node implementation and distribution. There
MUST NOT be a second local-only Node implementation inside Electron.

`REPO-005` The six named platform packages are the initial shared package set. Additional packages
MAY be introduced only when they have a named consumer and a stable ownership boundary. Node
domain services, Electron feature components, and plugin feature logic MUST NOT be moved into a
platform package without such a boundary.

`REPO-006` All twenty current first-party plugins, including the three System plugins and executable
profiles, MUST live under `plugins/`. Trust/runtime classification comes from the Acorn manifest,
not the source directory.

Future independently runnable products such as Plugin Studio or an Acorn-operated marketplace
service belong under `apps/` if and when they enter delivery scope. Their names are not reserved V2
workspace packages until that work is approved.

## Application composition and the bundled Node

`REPO-007` Applications are terminal nodes in the source dependency graph. `apps/desktop` MUST NOT
import implementation modules from `apps/node`, and `apps/node` MUST NOT import Electron. Both MAY
depend on versioned platform packages.

`REPO-008` `apps/node` produces the same standalone Node distribution used for remote and bundled
local operation. The desktop packaging task MUST depend on that immutable build output, place it in
the Electron distribution, and launch it as a supervised process. This is a build-artifact
dependency, not a JavaScript/TypeScript source import between applications.

`REPO-009` Development, test, and packaged execution MUST exercise the same Node entrypoint and V2
protocol. A test double MAY implement the protocol in `@acorn/plugin-testkit`, but it cannot become
an alternative production Node composition.

## Plugin source package

Each first-party plugin workspace package uses one logical version and one package root:

```text
plugins/<name>/
├── package.json
├── acorn-plugin.json
├── src/
│   ├── node/
│   ├── client/
│   └── contract/
├── schemas/
├── migrations/
├── assets/
├── native/
└── tests/
```

Only directories required by the plugin are present. `package.json` is pnpm/Turborepo build
metadata. `acorn-plugin.json` is the source form of the canonical manifest governed by
[`plugin-manifest-v2.schema.json`](../contracts/schema/plugin-manifest-v2.schema.json); marketplace
installation uses the signed canonical manifest and content-addressed artifacts, never workspace
linking.

`REPO-010` One logical plugin release MUST have one workspace `package.json`, one
`acorn-plugin.json`, one coordinated version, and one build that emits its complete logical
artifact set. Node, client, declarative, WASI, native, schema, migration, and asset sources are
subdirectories of that package, not independently versioned nested workspace packages.

`REPO-011` A plugin package MAY emit multiple independently hashed platform/client/Node artifacts
as required by `PLUG-MODEL-008`. Source-package unity does not combine artifact authority,
compatibility, verification, acquisition, or activation.

`REPO-012` Another plugin MUST NOT import `src/node`, `src/client`, private exports, generated
implementation modules, or workspace-relative paths from a plugin package. Cross-plugin consumers
compile against published capability/event/schema contracts and invoke them only through the core
broker at runtime.

`REPO-013` System plugin implementation entrypoints MAY be imported only by the explicit Node or
Electron System-plugin composition root. Boundary tests MUST reject every other plugin
implementation import. Verified/default plugins are collected as signed installable artifacts;
they are not statically linked merely because their source shares the monorepo.

## External plugin repositories

An external repository may contain a single plugin at its root:

```text
example-plugin/
├── package.json
├── acorn-plugin.json
├── src/
├── schemas/
└── tests/
```

It may instead contain several plugins under `plugins/*`. It may use Turborepo, another build
orchestrator, or no JavaScript workspace tooling.

`REPO-014` The Acorn SDK, source builder, and marketplace MUST validate the manifest, locked source,
build plan, and emitted artifact bundle. They MUST NOT require an external repository to copy
Acorn's monorepo directory names or use Turborepo.

`REPO-015` Moving a first-party Verified plugin to a separate repository MUST NOT change its
coordinate, manifest, artifact layout, capability/event contracts, lifecycle, or installation
behavior. Repository URL and commit provenance may change only through the ordinary signed release
process.

`REPO-016` A plugin that talks to a genuinely independently deployed companion service remains
under `plugins/`; the companion service belongs under `apps/` when it shares this monorepo, or in
its own repository. The plugin must still use brokered network and credential capabilities and
cannot gain authority from co-location.

## Build and dependency graph

The permitted source direction is:

```text
packages/*  ───────► apps/*
     │
     └─────────────► plugins/*

plugins/{agents,github,terminal} ──► explicit System composition roots only

apps/node build output ──► apps/desktop packaging task
```

Arrows mean “is consumed by.” They do not create runtime authority.

`REPO-017` A plugin MAY depend on platform packages. It MUST NOT depend on an application package
or another plugin implementation. An application MAY compose System plugin entrypoints and consume
signed plugin artifacts but MUST NOT expose its private modules as a plugin SDK.

`REPO-018` Turborepo tasks MUST expose deterministic `build`, `test`, `typecheck`, `lint`, and
artifact-validation boundaries where applicable. Outputs containing Node distributions, Electron
packages, plugin bundles, schemas, SBOMs, or provenance MUST be declared cache outputs; credentials,
signing keys, local data roots, and Developer Source state MUST never be cached as task outputs.

`REPO-019` Release assembly MUST consume immutable outputs from the two applications and all
selected plugin packages. The default installation profile is a signed lock/catalog over plugin
artifacts, not a list of source imports.

## Turborepo task graph

The canonical root pipeline and phase ordering are defined in
[build and implementation sequencing](../migration/build-and-implementation-sequencing.md).
Individual packages may omit tasks that do not apply, but they cannot rename an applicable
architectural gate into an opaque package-specific script.

`REPO-021` The root MUST expose `toolchain:verify`, `contracts:validate`, `contracts:generate`,
`contracts:check-generated`, `lint`, `typecheck`, `test:unit`, `build`, `artifact:assemble`,
`artifact:verify`, `test:contract`, `test:integration`, `test:security`, `test:parity`, `dist` and
`release:sign` tasks. A root task may dispatch several package tasks but MUST preserve their
evidence and failure status.

`REPO-022` All product `build` tasks MUST depend on the successful generated-contract check.
Application/plugin tasks consume platform-package outputs through ordinary Turbo dependency edges.
Desktop artifact assembly depends on verification of the standalone Node artifact, not merely on
its compilation.

`REPO-023` Normative contract sources and the golden generated-surface digest manifest are
committed. Generated bindings and distributable schema bundles are reproducible outputs and MUST
NOT be edited or shadowed by manually maintained TypeScript wire declarations.

`REPO-024` Turbo cache configuration MUST enumerate outputs and environment inputs narrowly.
Signing/notarization, secret-bearing tests, Developer Source builds and local persistent data roots
MUST be excluded from cache reads and writes.

`REPO-025` `dist` MUST consume verified application/plugin artifacts. `release:sign` is
non-cacheable and signs/notarizes the same candidate digest that passed contract, integration,
security and parity gates; it MUST NOT trigger a source rebuild.

`REPO-026` CI MUST retain an evidence index relating source revision, toolchain/contract digests,
package/final artifact digests, platform and test results. A cached task result is acceptable only
when its recorded inputs and artifact digest match that index.

## Conformance

`REPO-020` Repository-boundary tests MUST prove:

1. only `apps/*`, `packages/*`, and `plugins/*` roots contain workspace packages;
2. there is exactly one package root for every first-party plugin;
3. application-to-application source imports are absent;
4. plugin-to-plugin implementation imports are absent;
5. System implementation imports occur only at named composition roots;
6. the desktop bundle contains the exact digest produced by the standalone Node build;
7. every default-profile entry resolves to a signed plugin artifact; and
8. an external single-plugin repository can build and validate without Turborepo;
9. product builds fail on invalid or stale generated contracts;
10. generated bindings reproduce byte-for-byte under the locked toolchain;
11. cached outputs contain no credential or persistent owner data; and
12. release signing operates on the already-tested candidate digest without rebuilding it.
