# Docs migration: every document that changes, and when

Part of [docs/future/structure-followup/](./README.md). A phase is not done until the owning doc says
the new true thing. This file says which document owns each fact afterwards and which phase rewrites
it. Paths were checked on 2026-08-30. Phase 3 re-checks all of them.

## By document

| Document | Section | Phase | Change |
| --- | --- | --- | --- |
| `docs/architecture-overview.md` | Runtime topology | 0 | The diagram draws the desktop's helper process and the `@acorn/custody` package as two things. |
| `docs/architecture-overview.md` | Package boundaries, "The custody stack stays shell-free" | 0 | Package name. |
| `docs/architecture-overview.md` | Product model | 1 | Drops the four-name origin list; a task's origin is a plugin-declared source id or `local`. |
| `docs/architecture-overview.md` | Package boundaries, "The facade stays boring" | 2 | Names the two context types per side. |
| `docs/shell.md` | The helper process, custody | 0 | Package name; the process keeps "helper". |
| `docs/testing.md` | Where tests live, the boot test | 0 | Package name. |
| `docs/plugins.md` | wherever the helper is named | 0 | Package name. |
| `docs/plugins.md` | The plugin API | 2 | Gains the verb table and the loaded-versus-compiled type split. |
| `docs/plugins.md` | Loaded plugins | 2 | The prose list of never-present members becomes a pointer at the loaded type. |
| `docs/plugins.md` | Node-side extension points, Hooks, Collaboration rules | 2 | New verbs in every example. |
| `docs/plugin-authoring.md` | every `ctx.` example | 2 | New verbs. |
| `docs/contribution-kinds.md` | member column | 2 | Renamed members; `tools/arch/contributionKinds.test.ts` holds it. |
| `docs/first-party-plugins.md` | What a loaded plugin cannot have | 2 | Reason E cites the type split rather than prose. |
| `docs/workspaces-and-tasks.md` | Tasks, origins | 1 | Origin is plugin-declared; first pane comes from the tracking source. |
| `docs/managed-agents.md` | Harnesses, MCP registration | 1 | A harness declares its register and remove commands; core runs them. |
| `docs/agent-tools.md` | Context sections | 1 | Sections are owned by their plugins through `ctx.contextSections`; core assembles. |
| `docs/github-integration.md` | Preferences | 1 | `github.diff-view` is github's slice. |
| `docs/security.md` | The control plane, the trust store | 0 | Package name where the trust store is located. |
| `docs/future/README.md` | Programmes table | 0 (row exists), 3 | Row added with this folder; moved to retired in phase 3. |
| `docs/future/terminal/03-process-model.md`, `phase-0-host-switch-and-toy.md`, `phase-3-process-and-auth.md` | path hints | 0 | Package name. |
| `docs/future/client-plugins/03-device-provenance.md`, `phase-0-device-held-bundles.md`, `phase-4-device-config.md` | path hints | 0 | Package name. |
| `docs/future/remote.md` | Multi-node from a browser | 0 | `WebBroker` is described as the web host's composition of `@acorn/custody`. |

## By phase

- Phase 0: `architecture-overview.md` (topology, custody paragraph), `shell.md`, `testing.md`,
  `plugins.md`, `security.md`, the terminal and client-plugins hints, `remote.md`.
- Phase 1: `architecture-overview.md` (product model), `workspaces-and-tasks.md`,
  `managed-agents.md`, `agent-tools.md`, `github-integration.md`.
- Phase 2: `architecture-overview.md` (facade paragraph), `plugins.md` (three sections),
  `plugin-authoring.md`, `contribution-kinds.md`, `first-party-plugins.md`.
- Phase 3: everything above re-checked; `future/README.md` row retired; this folder deleted.
