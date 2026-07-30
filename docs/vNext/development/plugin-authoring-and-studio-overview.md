# Plugin authoring and Plugin Studio overview

Status: Normative boundary; informative product direction<br>
Requirement prefix: `PLUG-DEV`

V2 must be practical to extend, but the complete development-platform product is outside this
specification. This document records the minimum toolchain contract that the runtime, schemas and UI
must support and the intended boundary of a future Plugin Studio system plugin.

Source layout, Turborepo workspace roles, dependency direction, the bundled Node build relationship,
and the external-repository boundary are normative in
[repository and workspace structure](./repository-and-workspace-structure.md).
First-party contract generation, artifact assembly and evidence tasks join the root pipeline in
[build and implementation sequencing](../migration/build-and-implementation-sequencing.md);
external plugins expose equivalent SDK/CLI operations without depending on Acorn's Turborepo.

## Required authoring kit

- **PLUG-DEV-001:** Acorn MUST publish the exact manifest, OpenAPI, AsyncAPI, JSON Schema and WIT
  contracts from this specification with generated TypeScript and supported WASI-language bindings.
- **PLUG-DEV-002:** A CLI MUST create a deterministic plugin workspace, validate the complete
  manifest and referenced schemas, build each artifact, calculate digests/SBOM, run conformance
  fixtures, produce a local Developer Source bundle and explain every validation error with
  document path.
- **PLUG-DEV-002A:** The first-party scaffold MUST create the single-package
  `plugins/<name>/` layout defined by `REPO-010`. The external scaffold MUST also work at a
  repository root and MUST NOT require Turborepo; both forms produce the same manifest and artifact
  contract.
- **PLUG-DEV-003:** Local development MUST run against a disposable test Node and isolated
  Electron development profile. It cannot access the owner's production Node, credentials, plugins,
  cache or signing keys unless the owner performs a distinct high-risk connection.
- **PLUG-DEV-004:** The authoring kit MUST support declarative-only, WASI Component, Acorn
  Verified native test mode and bespoke UI sandbox projects. Native/bespoke templates do not weaken
  production isolation.
- **PLUG-DEV-005:** Test fixtures MUST simulate Node/client protocol ranges, missing renderer
  capabilities, compact/mobile fallback, denied/revoked permissions, dependency versions, duplicate/
  gapped events, offline/reconnect, lifecycle crash points and resource limits.

## Debug loop

The minimum loop is:

1. edit manifest/contracts/runtime/view assets;
2. validate and build immutable local bundle;
3. start or reset disposable test Node;
4. install in Developer Source mode with explicit simulated grants;
5. preview contributions at all states and size classes;
6. inspect structured commands, events, view documents/patches, bridge messages, health and audit;
7. run unit/contract/security/accessibility/lifecycle conformance;
8. package/sign for an eligible marketplace workflow.

- **PLUG-DEV-006:** Debug inspection MUST redact secrets and confidential values by default and
  must not expose capability tokens, pairing keys, raw authorization headers or production vaults.
- **PLUG-DEV-007:** Event/command replay tools operate only on synthetic or explicitly exported
  redacted fixtures. Replaying an event cannot be presented as replaying its original external
  effect.
- **PLUG-DEV-008:** UI preview MUST render loading, empty, ready, stale, offline, denied,
  unsupported, error, slow patch, update and disable states across themes/styles, accessibility
  modes and size classes.
- **PLUG-DEV-009:** Bespoke preview MUST use the production guest sandbox/CSP/bridge implementation
  and expose blocked-operation evidence outside the guest.
- **PLUG-DEV-010:** WASI/native debugging MUST preserve production capability brokerage and
  resource ceilings, with explicit test-only overrides displayed and excluded from distributable
  manifests.

## Future Plugin Studio

Plugin Studio is a future Acorn system plugin that may compose standard Acorn renderers:

- file/resource tree and code editor for project files;
- semantic/bespoke contribution preview panes;
- terminal/run-target pane for CLI commands;
- manifest/contract explorer and diagnostics;
- command/event/view-session/health inspector;
- permission and setup-wizard simulator;
- test/conformance result pane;
- package/sign/publish workflow.

- **PLUG-DEV-011:** Studio MUST call the same CLI/test-Node contracts and MUST NOT become an
  alternative privileged plugin runtime, installer or schema dialect.
- **PLUG-DEV-012:** Studio project trust follows repository configuration trust and Developer
  Source rules. Opening source does not run builds, terminals, preview code or hooks automatically.
- **PLUG-DEV-013:** Publishing requires explicit owner action, publisher-key protection, final
  clean build, SBOM/provenance capture, complete conformance results and marketplace policy checks.

## Documentation minimum

- **PLUG-DEV-014:** Public author documentation MUST include a full declarative, WASI, native and
  multi-plugin example; manifest/permissions/contribution/event/UI references; lifecycle/setup/
  storage rules; security model; compatibility/versioning; testing; packaging; publishing; update/
  rollback/uninstall behavior.
- **PLUG-DEV-015:** Generated reference and examples MUST be tested against the same schemas as the
  host. Copied hand-maintained wire types are non-conforming.

Detailed Studio information architecture, collaboration features, hosted build service, marketplace
publisher portal and commercial model are deliberately outside V2 implementation scope.
