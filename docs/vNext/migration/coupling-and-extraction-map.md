# Coupling and extraction map

**Status:** Normative migration contract<br>
**Requirement prefix:** `MIG`

Moving folders into packages does not create plugin isolation. V2 must replace every current
core-to-plugin and plugin-to-plugin implementation import with a core-owned renderer, capability,
contribution, or corrected ownership boundary.

`MIG-020` The V2 boundary conformance suite MUST report zero direct core-to-plugin and
plugin-to-plugin implementation imports outside generated contract types and declared test
fixtures.

## Current core-to-plugin edges

| Current edge | V2 replacement |
| --- | --- |
| `core/client/App.tsx` → GitHub `ComparePreview` | GitHub route/view contribution using `acorn.diff-review` |
| `core/client/App.tsx` → GitHub `CreatePullForm` | GitHub command plus declarative/bundled verified pane contribution |
| `core/client/App.tsx` → GitHub `DiffView` | GitHub pane contribution using built-in diff renderer |
| `core/client/App.tsx` → GitHub `PullDetail` | GitHub pane contribution |
| `core/client/App.tsx` → GitHub `PullList` | GitHub Fleet/workspace source contribution |
| `core/client/App.tsx` → Onboarding modal | Core wizard host plus onboarding wizard contribution |
| `core/client/App.tsx` → Terminal panel | Terminal drawer slot contribution using `acorn.terminal` |
| Command Palette → Agents workflow client | Workflow command contribution and capability invocation |
| Command Palette → Terminal recipes | Terminal layout-recipe contribution |
| Command Palette → Terminal run client | Terminal run-target command contribution |
| `TaskView` → Terminal run client | Task slot/command-state subscription |
| `TaskView` → Terminal client | Terminal session capability and drawer contribution |

## Current plugin-to-plugin edges

| Current edge | V2 replacement |
| --- | --- |
| Agents sidebar → Terminal client | Versioned Terminal session/attention capability |
| Changes → GitHub diff rows | Core `acorn.diff-review` renderer |
| Changes → GitHub diff model | Core diff document schema and renderer |
| Context → Memory UI | Memory context-section and action contributions |
| Context → Notes client | Notes context-section and navigation-intent contributions |
| Database → Editor Monaco setup | Core `acorn.code-editor` renderer |
| GitHub Pull Detail → Linear panel | External-reference contribution and navigation intent |
| GitHub Pull Detail → Linear scan | Declared Linear reference-detector capability |
| GitHub Pull List → Linear scan | Declared Linear reference-detector capability |
| Memory knowledge IPC → Notes store | Notes capability export; Memory declares dependency |
| Notes pane → Context model | Core context-section schema |
| Preview → Terminal run client | Terminal run-target capability with optional dependency |
| Workflows settings → Agents workflow client | Workflow-owned query contract and Client contribution |

`MIG-021` The listed replacement contracts MUST be declared in manifests and capability catalogs.
Composition-root injection of a concrete plugin object is not a valid replacement.

## Ownership corrections

`MIG-022` Node core owns generic filesystem confinement, Git/worktree primitives, process
supervision, command execution policy, repository-config trust, secret brokerage, storage tenancy,
plugin hosting, and transport. Terminal consumes these and owns terminal product semantics.

`MIG-023` Client core owns semantic editor, file-tree, search-result, diff, terminal, data-grid,
Markdown, wizard, and browser capability contracts. A first-party plugin may provide the bundled
implementation but another plugin imports only the core contract.

`MIG-024` Notes owns its routes and storage. Memory may call Notes only through a declared capability.
Context aggregates contributions without importing either implementation.

`MIG-025` Linear owns its reference detector, external-item panels, and navigation. GitHub knows only
the external-reference contract.

`MIG-026` Workflows owns workflow Client queries/actions. Agents consumes workflow lineage and
attention through declared capabilities/events.

`MIG-027` Acorn Node/device identity belongs to core and MUST NOT depend on GitHub authentication.

## Extraction order

The detailed wave gates are fixed by
[build and implementation sequencing](./build-and-implementation-sequencing.md). Within those
gates, coupling is removed in this order:

1. Define resource, capability, renderer, event, settings, and lifecycle contracts.
2. Put broker interfaces between current callers and implementations while behavior remains local.
3. Move generic primitives into core where ownership corrections require it.
4. Enforce the no-growth import baseline; each extraction wave removes every edge owned by the
   plugin it packages.
5. Package Terminal, GitHub and Agents in their ordered System-plugin gates.
6. Package the remaining first-party plugins in dependency layers, assigning storage and removing
   all remaining edges.
7. Enable runtime discovery, installation, and removal only after isolation tests pass.

`MIG-028` Runtime plugin loading MUST NOT ship while system or Verified plugins still require
unbrokered cross-plugin imports, shared mutable objects, or shared SQL.
