# Docs migration: every document under `docs/` that changes, and when

Part of [docs/future/workflows/](./README.md). A phase is not done until the owning doc says the
new true thing. This file says which document owns each behaviour afterwards and which phase rewrites
it. Paths were checked on 2026-09-08.

## By document

| Document | Section | Phase | Change |
| --- | --- | --- | --- |
| `docs/workflows.md` | § Execution model | 0 | The graph: `after`, readiness, `decide` in a graph, inputs, isolation, append mode, retry. |
| `docs/workflows.md` | § Contributed step kinds | 1 | `describe`, the field vocabulary, the catalog route, the four new kinds by owner. |
| `docs/workflows.md` | § Execution model, new § Database definitions | 2 | Two stores, one read; the table; save to repo; what a row may name. |
| `docs/workflows.md` | new § Authoring | 3, 6 | The rail source, the surface, the draft rules, the JSON tab, the graph view. |
| `docs/workflows.md` | § Routes and UI | 4 | The pane, per-kind detail, controls, the three frames. |
| `docs/workflows.md` | § From the command palette | 3, 4 | "New workflow"; "Find a run" reopened and the deferral paragraph deleted. |
| `docs/workflows.md` | new § Starting a run | 5 | The item menu flow and the prefill rule. |
| `docs/workflows.md` | § Gaps | every phase | Shrinks as each lands; "no general DAG editor" goes in phase 3. |
| `docs/future/orchestration.md` | § What this does not build | 0 | The DAG-editor and workflows-pane refusals are marked reversed with a pointer to this folder and the reason. |
| `docs/future/orchestration.md` | § Suggested phasing, step 9 | 2 | Marked done, pointing at phase 2. |
| `docs/plugins.md` | § Node-side extension points | 1 | A point's value may carry a description the host draws; the catalog pattern. |
| `docs/plugins.md` | § Context menus | 5 | `item.row` joins the locations; its facts; the three lists draw from the registry. |
| `docs/contribution-kinds.md` | Client contributions table | 5 | The context-menu row names both locations. |
| `docs/panes.md` | the pane list | 4 | The workflows pane, `list-detail`, gated by `when`. |
| `docs/notifications.md` | § What a row points at | 4 | The `workflow-run` target; a gate as an attention row; the `run-failed` notice. |
| `docs/managed-agents.md` | § Sessions | 0, 4 | A workflow turn may carry config options; the chip; `kind: 'workflow'` is read. |
| `docs/terminal.md` | new § Workflow steps | 1 | `terminal:command` and `terminal:run-target`. |
| `docs/database.md` | new § Workflow steps | 1 | `database:query`, `database:generate`, the `database.query` capability, the read-only rule. |
| `docs/http-client.md` | § the workflow step | 1 | The description. |
| `docs/api-reference.md` | workflows routes | 0, 1, 2 | Retry, the start body, the catalog, the defs routes, save to repo. |
| `docs/data-layer.md` | § Plugin databases | 2 | `workflow_defs`. |
| `docs/security.md` | § Process, path, and configuration controls | 2 | Owner-typed rows; save to repo re-enters the snapshot. |
| `docs/state-ownership.md` | § Device | 3 | `plugin:workflows:layout:<defId>`. |
| `docs/command-palette-and-shortcuts.md` | plugin rows | 3, 4 | "New workflow", "Find a run", the input dialog on "Run a workflow". |
| `docs/first-party-plugins.md` | rows | 1, 3, 4 | workflows gains a source, a surface, and a pane; terminal and database gain step kinds. |
| `docs/integrations.md` | the row menu | 5 | Registry-drawn. |
| `docs/testing.md` | § The smoke checklist | 3, 4, 5 | Edit and save; run and watch; start from an item. |
| `docs/ui-design.md` | § The closed kit, § Every node at 80 by 24 | 6 | The `Graph` node and both projections. |
| `docs/tui.md` | § What a plugin loses here | 6 | Nothing new lost; the graph draws as the list. |
| `docs/README.md` | index | now | The workflows row's one line names authoring and runs once phase 3 lands; unchanged until then. |
| `docs/future/README.md` | programmes table | now | This folder's row; orchestration's row notes the reversal. |

## By phase

- **0**: workflows.md, orchestration.md, managed-agents.md, api-reference.md.
- **1**: workflows.md, plugins.md, terminal.md, database.md, http-client.md, api-reference.md,
  first-party-plugins.md.
- **2**: workflows.md, orchestration.md, data-layer.md, security.md, api-reference.md.
- **3**: workflows.md, state-ownership.md, command-palette-and-shortcuts.md, first-party-plugins.md,
  testing.md.
- **4**: workflows.md, panes.md, notifications.md, managed-agents.md, command-palette-and-shortcuts.md,
  first-party-plugins.md, testing.md.
- **5**: workflows.md, plugins.md, contribution-kinds.md, integrations.md, testing.md.
- **6**: workflows.md, ui-design.md, tui.md.

## When the folder closes

When phase 6 ships, this folder shrinks to a pointer in `docs/future/README.md`'s retired list, as
every finished programme has, naming where each behaviour moved. `refused.md`'s arguments go to
`docs/workflows.md` as a § What workflows refuses, in the shape the changes panel used.
