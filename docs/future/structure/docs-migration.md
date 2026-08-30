# Docs migration: every document under `docs/` that changes, and when

Part of [docs/future/structure/](./README.md). A phase is not done until the owning doc says the new
true thing. This file says which document owns each fact afterwards and which phase rewrites it.
Paths were checked on 2026-08-30. Phase 7 re-checks all of them.

## By document

| Document | Section | Phase | Change |
| --- | --- | --- | --- |
| `docs/README.md` (new) | whole file | 1 | Created. The index of every file under `docs/`, by kind. |
| `docs/conventions.md` (new) | whole file | 1 | Created from [02-conventions.md](./02-conventions.md). Phase 6 adds which rules are test-enforced. |
| `docs/architecture-overview.md` | Documentation map | 1 | Shrinks to a pointer at `docs/README.md` (new) plus a reading order. |
| `docs/architecture-overview.md` | Package boundaries | 4, 6 | Subpath table drops `./main/index.ts`; names the folder-shape rule. |
| `docs/architecture-overview.md` | Process ownership, the `src/shell/` sentence, the desktop-helper paragraph | 2, 3 | New paths for the helper process and the helper package's groups. |
| `docs/plugins.md` | Activation | 1 | Split into its 15 topics as h2s. |
| `docs/plugins.md` | The canonical layout (lines 16 to 30) | 1, 4 | Seven-folder shape; `frame/` becomes `tree/`; `testkit/` and `node/schema.ts` added; "target" marker removed in phase 4. |
| `docs/plugins.md` | The manifest schema | 1 | Shrinks to the host-read fields and a link to `plugin-authoring.md`. |
| `docs/plugins.md` | The tree contract, the client half | 5 | client-core paths under `host/` and `kit/`. |
| `docs/plugin-authoring.md` | The manifest, the scaffold | 1, 7 | Becomes the one manifest reference; the emitted layout matches phase 4. |
| `docs/first-party-plugins.md` | What a loaded plugin cannot have | 1 | Pointer at `docs/extensibility.md`. |
| `docs/first-party-plugins.md` | Per-plugin paths | 4 | `src/main/` citations. |
| `docs/extensibility.md` | Two tiers, permanently | 1 | Gains the sentence `first-party-plugins.md` gave up. |
| `docs/plugin-map.md` | top | 1 | Named from `docs/README.md` (new) as the orientation doc. |
| `docs/contribution-kinds.md` | none | | Unchanged; already test-enforced. |
| `docs/pg.md` | whole file | 1 | Moved to `docs/database.md` or folded into `docs/data-layer.md`. |
| `docs/terminal-and-agents.md` | whole file | 1 | Moved to `docs/terminal.md` with a paragraph on how it differs from managed agents and from `docs/future/terminal/`. |
| `docs/state.md` | whole file | 1 | Moved to `docs/state-ownership.md`. |
| `docs/release-notes-vnext.md` | whole file | 1 | Moved to `docs/release-notes.md`. |
| `docs/third-party/README.md`, `docs/third-party/monaco.md` | whole files | 1 | Moved to `docs/loaded-plugin-migration.md` and `docs/editor-monaco.md`; folder deleted. |
| `docs/next-review.md` | whole file | 0 | Deleted; open items moved into the relevant `docs/future/` file. |
| `docs/shell.md` | The helper, the bridge, the plugin worker | 2, 3 | `apps/desktop/src/helper/`, desktop-helper groups. |
| `docs/node-distribution.md` | The standalone entry, the service entry | 2 | `apps/node/src/entries/`. |
| `docs/local-development.md` | Running the node, the desktop | 2 | Entry paths. |
| `docs/mcp.md` | The MCP entry | 2 | `apps/node/src/entries/mcp.ts` (new). |
| `docs/testing.md` | Where tests live, the testkit, CI | 2, 3, 6 | Grouped integration tests, helper suffix, colocation rule, the CI section. |
| `docs/security.md` | The secrets module (lines 166 and 560), the trust store | 3 | One spelling of `core/secrets`; desktop-helper paths. |
| `docs/data-layer.md` | Core database, plugin storage | 3 | `server/storage/`, `server/plugins/`. Absorbs `pg.md` if phase 1 folds it. |
| `docs/node-enrollment.md` | The schema pin | 3 | `enrollmentSchema.test.ts` path. |
| `docs/schedules.md`, `docs/managed-agents.md` | node-core citations | 3, 4 | `server/pluginHost/`, `plugins/agents/src/server/`. |
| `docs/github-integration.md`, `docs/workflows.md`, `docs/notes-and-memory.md`, `docs/docker.md`, `docs/http-client.md` | plugin paths | 4 | `src/main/` becomes `src/server/`; routes subfolders. |
| `docs/frontend.md` | Package layout, shell state | 5 | The four client-core groups. |
| `docs/ui-design.md` | The closed kit, Every node at 80 by 24 | 5 | `kit/` paths; `tools/arch/kitTable.test.ts` reads the same table. |
| `docs/panes.md` | Layout model | 5 | `host/layouts/`. |
| `docs/command-palette-and-shortcuts.md` | Focus and typing, the keymap | 5 | `host/keys/`, `host/palette/`. |
| `docs/dashboards.md` | The re-export shims | 5 | Removed or documented, per the phase's choice. |
| `docs/state-ownership.md` (new) | Client-owned durable state | 5 | `infra/persistence/`. |
| `docs/future/README.md` | Programmes table, retired folders, status header date | 1, 7 | Row added for `structure/`; moved to retired in phase 7. |
| `docs/future/ecosystem/`, `docs/future/sandbox/`, `docs/future/marketing/` | `refused.md` | 1 | Created from the inline refusals. |
| `docs/future/terminal/*`, `docs/future/client-plugins/*` | path hints, `docs-migration.md` | 7 | Rewritten against the new tree. |
| `docs/future/compiled-tier.md`, `docs/future/split.md` | plugin shape | 7 | Seven-folder shape. |
| `CLAUDE.md` | top | 1 | Points at `docs/README.md` (new) and `docs/conventions.md`. |
| `README.md` (root) | Repo layout, doc index, line 110 | 0, 1 | `docs/smolforge/` removed; points at `docs/README.md` (new). |

## By phase

- Phase 0: `README.md` line 110, `docs/next-review.md`.
- Phase 1: the index, conventions, the plugin docs, four renames, `docs/third-party/`, the three
  `refused.md` files, `CLAUDE.md`.
- Phase 2: `shell.md`, `node-distribution.md`, `local-development.md`, `mcp.md`, `testing.md`,
  `architecture-overview.md` (process ownership).
- Phase 3: `security.md`, `data-layer.md`, `node-enrollment.md`, `schedules.md`, `managed-agents.md`,
  `shell.md`, `testing.md`, `architecture-overview.md` (desktop-helper).
- Phase 4: `plugins.md` (target marker), `architecture-overview.md` (subpath table),
  `first-party-plugins.md`, the seven plugin feature docs.
- Phase 5: `frontend.md`, `ui-design.md`, `panes.md`, `command-palette-and-shortcuts.md`,
  `plugins.md`, `dashboards.md`, `state-ownership.md`.
- Phase 6: `testing.md` (CI), `architecture-overview.md` (folder-shape rule), `conventions.md`.
- Phase 7: everything above re-read; `docs/future/*`; this folder deleted.
