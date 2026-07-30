# Plugin model

Status: Normative<br>
Requirement prefix: `PLUG-MODEL`

An Acorn plugin is a signed, immutable bundle of declarations and zero or more runtime artifacts
that extend Acorn through brokered contracts. A plugin is never a package imported directly by
another plugin. This document defines the unit of installation; the
[manifest reference](./manifest-reference.md), [runtime documents](./wasi-component-runtime.md),
[contribution catalog](./contribution-catalog.md), and
[repository structure](../development/repository-and-workspace-structure.md) define its parts and
source boundary.

## Identity and installation

- **PLUG-MODEL-001:** The canonical coordinate MUST be
  `<publisher>/<name>@<semver>`. `publisher` and `name` MUST be lowercase DNS-label-like strings,
  1–63 characters each, and globally stable after publication.
- **PLUG-MODEL-002:** The immutable artifact identity MUST be
  `sha256:<lowercase-hex-digest>`. A coordinate resolves to exactly one artifact identity within a
  marketplace generation; changing bytes requires a new version.
- **PLUG-MODEL-003:** A plugin installation is Node-scoped. Its client artifact is installed into
  each paired Electron client that elects to present that Node, but activation, grants, settings,
  setup state, data, and health remain separate per Node installation.
- **PLUG-MODEL-004:** Installing the same coordinate on two Nodes creates independent
  installations. No secret, grant, data, setup state, or mutable plugin state is implicitly shared.
- **PLUG-MODEL-005:** All plugin-owned identifiers MUST be namespaced below the coordinate without
  its version, for example `example/search.command.reindex`. Identifiers MUST remain stable across
  compatible releases.
- **PLUG-MODEL-006:** The core MUST reject duplicate contribution, command, capability, event,
  settings, wizard, route, or storage identifiers before activation.

## Logical artifact set

| Artifact | Runs in | May be absent | Authority |
| --- | --- | --- | --- |
| Manifest and schemas | verifier/core | no | declaration only |
| Declarative UI | Electron semantic renderer | yes | view-session grant only |
| Bespoke UI | isolated Electron guest | yes | typed message bridge only |
| WASI component | Node plugin worker | yes | preopened capabilities only |
| Native executable | Node OS sandbox | yes | sandbox plus broker grant |
| System module | Node or Electron trusted process | system plugins only | explicit internal interface |
| Assets | renderer or documentation host | yes | inert, content-sniffed resources |
| Migrations | isolated plugin database migrator | yes | one plugin database only |

- **PLUG-MODEL-007:** A bundle MUST contain the manifest, referenced schemas, artifact digests,
  publisher signature material, SBOM, and license metadata. It MAY contain any compatible subset
  of the optional artifacts in the table.
- **PLUG-MODEL-008:** Node and client artifacts MUST be independently addressable, hashed, signed,
  versioned, and compatibility-constrained even when distributed in one archive.
- **PLUG-MODEL-009:** A remote Node MUST never supply executable UI bytes to Electron. Electron
  MUST resolve the declared client artifact by coordinate and digest from its trusted local cache
  or configured marketplace, verify it independently, and refuse a digest mismatch.
- **PLUG-MODEL-010:** Absence of a compatible client artifact MUST not prevent a headless Node
  runtime from operating when the manifest marks the client artifact optional. Electron MUST show
  the declared semantic fallback or an explicit unsupported-client surface.

## Runtime and trust tiers

| Runtime tier | Intended use | Execution boundary |
| --- | --- | --- |
| `declarative` | data, commands, settings, semantic UI | no plugin code in renderer |
| `wasi-component` | default community computation and integrations | supervised WASI component |
| `native-process` | verified tooling requiring native APIs | supervised OS sandbox |
| `system` | GitHub, Terminal, Agents and core-adjacent first-party behavior | linked trusted module |

| Trust tier | Distribution | Review meaning |
| --- | --- | --- |
| `system` | Acorn release | release-signed and shipped as part of Acorn |
| `acorn-verified` | trusted marketplace | publisher, provenance, requested authority, and review policy verified |
| `community` | community marketplace | signed and attributable; not reviewed by Acorn |
| `developer-source` | pinned source or local path | user accepts development or unrestricted-code risk |

- **PLUG-MODEL-011:** Trust and runtime are distinct. A verified plugin does not receive ambient
  authority, and a declarative plugin does not become trusted merely because it cannot execute code.
- **PLUG-MODEL-012:** `community` plugins MAY use declarative UI, WASI Components, and sandboxed
  bespoke UI. They MUST NOT use native executables.
- **PLUG-MODEL-013:** `native-process` requires `acorn-verified` provenance and a platform sandbox
  capable of enforcing every declared resource limit and capability. If enforcement is unavailable,
  activation MUST fail closed.
- **PLUG-MODEL-014:** An unsandboxed executable is allowed only in `developer-source` mode after an
  owner confirmation that states it is unrestricted local code execution. It MUST be visually and
  auditably distinct from a sandboxed installation.
- **PLUG-MODEL-015:** `system` runtime is reserved to release-signed Acorn artifacts. Marketplace
  publishers cannot request or emulate it.

## Ownership and boundaries

- **PLUG-MODEL-016:** Core owns identities, Fleet membership, Nodes, paired devices, workspaces,
  repositories, tasks, resource addressing, grants, secrets, event transport, plugin lifecycle,
  process supervision, audit, and the UI host.
- **PLUG-MODEL-017:** A plugin owns its installation state, declared settings, setup instances,
  plugin database, plugin events, exported capabilities, view-session state, and runtime health.
- **PLUG-MODEL-018:** A plugin MAY read or mutate core resources only through public versioned
  queries and commands covered by an active grant. It MUST NOT access core tables, private routes,
  process objects, Electron objects, or another plugin's files or database.
- **PLUG-MODEL-019:** Cross-plugin behavior MUST use declared brokered capability calls, events, or
  resource links as specified in [dependencies and collaboration](./dependencies-and-collaboration.md).
- **PLUG-MODEL-020:** All values crossing a process, Node/client, runtime, or plugin boundary MUST
  be schema-validated, bounded, serializable values. File descriptors, database handles, callbacks,
  DOM nodes, `webContents` identifiers, and secret plaintext MUST NOT cross.

## Compatibility

- **PLUG-MODEL-021:** A plugin MUST declare protocol, manifest, runtime ABI, renderer capability,
  dependency, and platform compatibility ranges. The installer MUST solve the complete set before
  staging bytes or requesting permission.
- **PLUG-MODEL-022:** Compatibility checks MUST use semantic version ranges plus named capability
  versions; product-version comparison alone is insufficient.
- **PLUG-MODEL-023:** Node activation MUST be independent of the order in which manifests are
  discovered. The solver MUST produce a deterministic lock or a structured conflict.
- **PLUG-MODEL-024:** Required dependency absence or incompatibility MUST block activation.
  Optional dependency absence MUST disable only the contributions that explicitly require it.
- **PLUG-MODEL-025:** A newer manifest or wire feature unknown to the host MUST be rejected unless
  the relevant schema marks the field as safely ignorable. Unknown authority requests MUST never be
  ignored or implicitly granted.

## Invariants

- **PLUG-MODEL-026:** There are no install scripts, ambient environment variables, shared global
  module registries, direct feature imports, cross-plugin SQL, or distributed transactions.
- **PLUG-MODEL-027:** Every external effect MUST be attributable to a plugin installation, caller,
  Node, task/workspace scope where applicable, command or event correlation, and granted capability.
- **PLUG-MODEL-028:** Disablement MUST stop new work immediately and drain or cancel in-flight work
  according to the command's declared cancellation semantics.
- **PLUG-MODEL-029:** Uninstall MUST be an explicit lifecycle operation; deleting bundle files is
  not uninstall and MUST be reconciled as corruption.
- **PLUG-MODEL-030:** Plugin failure MUST be contained. The core, Electron shell, another plugin,
  and unrelated Node connections MUST remain usable after a plugin crash or invalid contribution.
- **PLUG-MODEL-031:** A plugin is an installable hosted product, not an Acorn application or a
  reusable implementation library. Its source may live in Acorn's `plugins/` workspace, at the root
  of an external repository, or in another supported source layout without changing its runtime
  classification.
- **PLUG-MODEL-032:** The source `package.json`, package-manager workspace, and Turborepo task graph
  have no installation authority. The signed manifest, artifact digests, dependency lock,
  provenance, grants, and lifecycle state are the complete installation boundary.

## Conformance

A conforming implementation MUST prove:

1. an altered artifact fails signature/digest verification;
2. a client refuses UI bytes received from a Node;
3. duplicate identifiers fail before activation;
4. a plugin cannot open core or another plugin's database;
5. unavailable optional dependencies suppress only dependent contributions;
6. unavailable native sandbox enforcement fails closed;
7. disable/restart/reinstall reconcile to the persisted lifecycle state; and
8. an unrecognized permission is denied rather than ignored.
