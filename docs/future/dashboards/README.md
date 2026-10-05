# Panel studio: creating, editing, and previewing dashboard panels

Status: proposed, October 5, 2026. [Phase 1](./01-quick-wins.md),
[phase 2](./02-plan-outline-model.md), [phase 3](./03-studio-shell.md),
[phase 4](./04-inspectors.md), [phase 5](./05-launcher.md), [phase 6](./06-docked-ai.md),
[phase 7](./07-panel-menu.md), [phase 8](./08-source-inputs.md), [phase 9](./09-input-consent.md),
and [phase 10](./10-inputs-in-the-studio.md) shipped on October 5, 2026, with phase 8's GitHub
branch source move left open. The other phases aren't built. Phases 8 to 12, derived sources, were added the same day. This programme
replaces the dashboards programme that lived in this folder. Its workstreams 1 to 7 shipped by
October 4, 2026, and its files were removed on October 5, 2026; git history keeps them (commit
`1d8c37913`).

Read this page before any phase. It says what's wrong, what we're building, the decisions already
made, the order of work, and how to check your work in the app. Two pages are the design source.
Open them beside these files:

- The [Panel Editor Review](https://claude.ai/artifact/EA1H3DdvVEUd9WTNg5MWyf) covers phases 1 to
  7: screenshots of today's editor, the findings, and mockups of the launcher, studio, and docked AI.
- [Derived Sources](https://claude.ai/artifact/W8vHKDojobsSD4GYi5xPxK) covers phases 8 to 12: how a
  third-party plugin builds a source from GitHub, Linear, and other sources with its own logic, from
  writing and testing it to approving and using it in a panel.

[Dashboards](../../dashboards.md) and its topic pages own shipped behaviour and win over anything
here until a phase changes them.

## What's wrong

The panel plan (`PanelPlan` version 2 in `packages/protocol/src/dashboards/panels.ts`) can do a lot:
up to eight sources, relations, columns, eight steps, sorting, grouping, row actions, and AI
authoring. The editor shows all of it at once. `DashboardEditor.tsx` draws a control for every plan
field, in schema order, in a 720-pixel `Modal`. Measured in a `dev:agent` session on October 5, 2026,
on commit `89a5143d2`:

- After picking one source, the editor shows 129 controls. The form is 4,353 pixels tall in a
  519-pixel viewport.
- Most selects have no visible label, and option labels are schema values such as `enum`, `eq`,
  and `primary`.
- Rows can be filtered in two places, and there are two previews.
- Problems show as JSON pointers before you've chosen anything, while **Publish** stays enabled for
  an invalid plan.
- The AI is a collapsed fold, and its proposals are lists of JSON paths.
- **Add panel** silently reopens the newest abandoned draft.

The review page has the full list with evidence.

## What we're building

Three pieces, each drawn from a pattern acorn already has:

- **A launcher.** **Add panel** opens one small screen. You type what you want to see, which
  starts the AI, or you pick a source and account, optionally with a starter panel. Unfinished
  drafts are listed openly.
- **A studio.** A full-window layer laid out like the Workflows editor. It has a toolbar, the plan
  as an outline in plain words, the real panel as a live preview, an inspector for the selected
  part, and a status bar. It supports undo, redo, and a publish review.
- **A docked AI.** The authoring conversation sits beside the plan. Its proposals show as marks on
  the outline and a before and after on the preview, and you apply one as a single undoable step.

Small edits after publishing (rename, view, sort) move to the panel's own menu.

## Derived sources

People want panels that apply their own rules to data Acorn already reads. For example, a team's
"Release readiness" panel takes the Linear issues in the current cycle, finds their pull requests,
and marks each issue Ready, At risk, or Blocked by the team's own rules. Panel steps are a closed
set, so that logic belongs in a plugin.

Phases 8 to 12 let a third-party plugin publish a _derived source_: an ordinary data source that
declares other sources as inputs. Acorn reads the inputs on its behalf, with the accounts the person
chose for that panel, and the plugin returns records in the shape it declared. Panels, workflows,
datasets, and the AI author all accept it like any other source.

Today a loaded plugin can't do this. `ctx.dataSources.invoke` refuses another plugin's source for
loaded code (`packages/node-core/src/server/pluginHost/context.ts`). A source can't ask for an account
from a provider it doesn't own (`packages/node-core/src/server/dataSources/authority.ts`). The trust
prompt and plugin page say nothing about data, and the author tools have no data source template or
test helper. Compiled plugins can already do it, and GitHub's branch source does.

## Decisions already made

These are settled. Raise a concern with the owner before building against one of them, rather than
working around it.

1. **The studio is a full-window layer, not a route.** The desktop renderer's routes only fill in
   params. What's on screen comes from `selectedSource()` and the active task
   (`apps/desktop/src/client/App.tsx`). Panels are also edited from task pane asides
   (`ChromeExtendedPane.tsx`), and switching surface would unmount the task's panes, plugin frames,
   and terminal drawer. Settings is already a full-window layer for the same reason. The review
   page leaned towards a route. This decision replaces that.
2. **The plan schema doesn't change.** Stages keep having no ids, and there's no hidden-column
   flag. Published revisions and their digests stay valid. Where the UI needs identity, it derives
   it ([phase 2](./02-plan-outline-model.md)).
3. **Workflows is the pattern.** Copy its toolbar, list and detail, status bar, publish review, and
   undo model. Don't import from the workflows plugin. Move shared helpers into client-core if both
   need them.
4. **The requirements checklist stops being a publish gate** in [phase 6](./06-docked-ai.md).
   Applying a proposal accepts it, and gaps show as warnings.
5. **Quick edits publish straight away**, and refuse when the panel has unpublished studio edits
   ([phase 7](./07-panel-menu.md)).
6. **Source-level conditions are hidden for new sources and kept for existing ones.** Panel filter
   steps push down to the source on the Node, so a second filter place isn't needed. Existing source
   conditions change rows, so the editor shows them read-only rather than dropping them.
7. **Every step form registers against its operation**, so the editor grows by registry, not by
   editing one big component ([phase 4](./04-inspectors.md)).
8. **Custom logic lives in a derived source, not in a panel step.** A source works everywhere a
   source works, keeps panel steps a closed set, and keeps plugin code out of the Node's plan runner.
9. **Acorn reads a derived source's inputs, never the plugin.** The plugin gets handles scoped to one
   request's chosen accounts. It never sees credentials, can't run actions or writes on inputs, and
   can't read a source it didn't declare ([phase 8](./08-source-inputs.md)).
10. **Accounts are chosen per panel, and approval is per input list.** The person approves which
    sources a plugin reads once. Each panel still picks which account each input uses
    ([phase 9](./09-input-consent.md)).
11. **Acorn draws every fix.** Loaded plugins can't open Settings, so **Connect…**, **Reconnect…**,
    and **Review** buttons are host UI ([phase 10](./10-inputs-in-the-studio.md)).

## The phases

| Phase | What it delivers | Depends on |
| --- | --- | --- |
| [1. Quick wins](./01-quick-wins.md) | Labels, plain words, only relevant options, no early errors, a gated **Publish**, sensible default columns, one filter and one preview, no silent draft resume. All inside today's modal. | Nothing |
| [2. Plan outline model](./02-plan-outline-model.md) | Pure functions in `dashboards-core`: the plan as named parts in plain words, problem and row-count mapping, available operations and views with reasons, and a part-level diff. | Nothing |
| [3. Studio shell](./03-studio-shell.md) | The full-window studio with toolbar, outline, live preview at real sizes, inspector, status bar, undo and redo, and a publish review. Today's forms move into the inspector. The modal is deleted. | 2 |
| [4. Inspectors](./04-inspectors.md) | Every inspector rewritten in plain words with typed value pickers and no IDs, behind an operation registry. | 1, 3 |
| [5. Launcher](./05-launcher.md) | The **Add panel** launcher, and starter plans for built-in sources. | 3 |
| [6. Docked AI](./06-docked-ai.md) | The docked conversation, proposal review on the outline and preview, aimed requests, and the end of the requirements gate. | 2, 3 |
| [7. Panel menu](./07-panel-menu.md) | Rename, view, and sort from the panel menu, **About this panel**, **Duplicate**, and an **Edit…** path from **Add as panel**. | 2; 3 for the edit entries |
| [8. Source inputs](./08-source-inputs.md) | Declared inputs on a data source, per-input account bindings, host-mediated reads through the request context, input grants, composed versions, and incomplete and invalid-record handling. GitHub's branch source moves onto it. | Nothing |
| [9. Input consent](./09-input-consent.md) | The **Reads your data** and **Provides** lines in the approval dialog, node-side input grants with an update diff, and data sources and inputs on the plugin page. | 8 |
| [10. Inputs in the studio](./10-inputs-in-the-studio.md) | Input account pickers in the launcher and inspector, input rows in the outline, host-drawn **Connect…** fixes, plain failure messages for every source, and AI support for inputs. | 8; 3, 4, 5 |
| [11. Derived source SDK](./11-derived-source-sdk.md) | `defineDerivedSource`, field builders, typed input handles, `testDerivedSource` with real field fixtures, the `--data-source` scaffold, and an agent prompt. | 8 |
| [12. Plugin dev loop](./12-plugin-dev-loop.md) | Development mode for folder-installed node plugins, reload on save, an in-app log view, and the studio's development strip. | 8, 11; 3 for the strip |

Phases 1 and 2 can run at the same time. After phase 3, phases 4, 5, and 6 can run at the same time
if their owners agree who touches `inspectors.tsx` and `studioStore.ts` first. Phase 7's quick
edits can ship any time after phase 2.

Phase 8 doesn't depend on the studio, so it can start beside phase 1. Phases 9 and 11 follow it and
can run at the same time. Phase 10 waits for phases 3 to 5. Phase 12 comes last.

[refused.md](./refused.md) lists what this programme decided not to build.

## Terms

| Term | Meaning |
| --- | --- |
| _Plan_ | A panel's definition, `PanelPlan` version 2. The code says plan. |
| _Part_ | One named piece of a plan the studio can select: a source, the columns, one column, a step, arrange, look, behaviour, or settings. Defined in phase 2. |
| _Step_ | What the code calls a stage: filter, compute, summarize, expand, or overlap. The UI says step. |
| _Outline_ | The studio's left column, listing the plan's parts in plain words. |
| _Inspector_ | The studio's right column, showing the selected part's form. |
| _Proposal_ | An AI reply that carries a candidate plan. |
| _Review_ | The studio state while a proposal is pending. |
| _Draft_ | The Node's editable copy of a plan. A published revision is immutable. |
| _Derived source_ | A data source that declares other sources as inputs and returns records built from them. |
| _Input_ | One named source a derived source reads, such as `pulls` for `github:pull-requests`. |
| _Binding_ | The account and parameters chosen for one input, stored in the query's `scope.inputs`. |
| _Input grant_ | The Node's record that the person approved a plugin's list of inputs. |

## Where things live

| What | Where |
| --- | --- |
| Plan schema | `packages/protocol/src/dashboards/panels.ts` |
| Plan logic, validator, describer | `packages/dashboards-core/src/plan.ts` |
| Operations, views, measures | `packages/dashboards-core/src/capabilities.ts` |
| Today's editor (deleted in phase 3) | `packages/client-core/src/features/dashboards/DashboardEditor.tsx` |
| Editor host and placement | `packages/client-core/src/features/dashboards/DashboardPanelHost.tsx` |
| Panel grid and menu | `packages/client-core/src/features/dashboards/PanelGrid.tsx`, `PanelGridItem.tsx` |
| Placed panel | `packages/client-core/src/features/dashboards/PublishedDashboardPanel.tsx` |
| Views | `packages/client-core/src/features/dashboards/views/PanelBody.tsx` and its siblings |
| Source and account picker | `packages/client-core/src/features/dataSources/SourceQueryEditor.tsx` |
| AI conversation | `packages/client-core/src/features/dataSources/AuthoringConversation.tsx` |
| Authoring route | `packages/node-core/src/server/routes/authoring.ts` |
| Run route | `packages/node-core/src/server/dashboards/run.ts` |
| Layout to copy | `plugins/workflows/src/client/editor/WorkflowEditor.tsx`, `draftStore.ts` |
| Full-window layer to copy | `packages/client-core/src/features/settings/SettingsView.tsx` |
| Source registration schema | `packages/protocol/src/data/dataSourceContributions.ts` |
| Source request and scope schemas | `packages/protocol/src/data/dataSources.ts` |
| Source runtime and checks | `packages/node-core/src/server/dataSources/runtime.ts`, `authority.ts`, `dispatch.ts` |
| Plugin context and request context | `packages/node-core/src/server/pluginHost/context.ts`, `requestContext.ts` |
| Trust and approval dialogs | `packages/client-core/src/host/trust/PluginTrustDialog.tsx`, `PluginApprovalDialog.tsx` |
| Plugin settings | `packages/client-core/src/features/settings/plugins/PluginsSettings.tsx`, `PluginPage.tsx` |
| Published SDK, types, and scaffold | `packages/plugin-sdk`, `packages/plugin-types`, `packages/create-acorn-plugin` |
| A derived source today (compiled) | `plugins/github/src/server/data/branchSourceHandler.ts` |

New studio files go in a `studio/` folder inside `packages/client-core/src/features/dashboards`.
New pure functions go in `packages/dashboards-core/src` and need an entry in that package's
`exports` map.

## Rules that apply to every phase

- Use only kit components, and never pass `class` to one. Put layout CSS on the feature's own
  wrapper elements in `dashboards.css`. See `docs/ui-design/closed-kit.md`.
- Keep the Node as the only executor. The client draws runs and never computes plan results.
- Keep behaviour, persisted data, and public contracts unless a phase says otherwise. A props
  change to `AuthoringConversation` or anything else exported through `@acorn/plugin-api` updates
  `tools/arch/publishedPluginSurface.snapshot.txt` on purpose.
- Every visible string is plain language. The label map from phase 1 is the one place schema values
  become words.
- Keyboard first: every control is reachable, and focus returns to what opened a dialog.

## Check it in the app

Unit tests can't show whether the studio is usable. Check each phase in a real session:

1. Run `pnpm install --frozen-lockfile` if this is a fresh worktree.
2. Start `pnpm dev:agent -- --session panels`. The session has its own data and ports and adds this
   checkout as a project. Its first build compiles the debug binary and takes a few minutes.
3. In a second terminal, run `pnpm dev:agent:ui -- --session panels snapshot` to list elements with
   references, then `click`, `fill`, `scroll`, and `screenshot NAME.png`. Screenshots land in
   `.acorn/agent-dev/panels/screenshots/`.
4. The window starts hidden, and screenshots from a hidden window are stale. Get the process id from
   `pnpm dev:agent:ui -- --session panels target` and bring it to the front with
   `osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is PID) to true'`.
5. Finish with `pnpm dev:agent:ui -- --session panels stop`.

The session has no GitHub account, so use **Workspace tasks** or **Local worktrees** unless you
connect one. The AI path needs a model backend.

For more, see [local development](../../local-development.md).

## Tests and gates

- While you work: `pnpm test:focus <package> <file>`.
- Before handoff: `pnpm lint`, then `pnpm test --filter=@acorn/client-core`,
  `pnpm test --filter=@acorn/dashboards-core`, and `pnpm test --filter=@acorn/node-core` for any
  phase that touches the describer or authoring.
- If you change a doc: `pnpm --filter @acorn/arch-tests test`.
- Phases 8, 9, and 11 change published plugin types. Run the arch tests and update
  `tools/arch/publishedPluginSurface.snapshot.txt` on purpose.
- Phase 11 adds tests to `packages/plugin-sdk`: `pnpm test --filter=acorn-plugin-sdk`.
- Component tests (`.test.tsx`) in client-core run under jsdom in the `hosts` project.

## The terminal client

The terminal client draws no dashboards (`apps/tui/src/plugins/ExtendedPane.tsx`), so nothing here
changes it. The outline is text first, so a later terminal panel editor could reuse
`planOutline` from phase 2.

## Docs that change

- `docs/dashboards/mapping-and-editor.md` is rewritten section by section as phases land. Keep the
  heading "The generated editor": `packages/client-core/src/features/dashboards/layout.ts` cites it.
- `docs/dashboards/placements.md`: region checks at publish, and the panel menu.
- `docs/ui-design/overlays.md`: the studio as a full-window layer beside Settings.
- `docs/data-sources.md` and `docs/plugin-authoring.md`: starter plans and `viewerMatch`.
- `docs/api-reference/core-routes.md`: the authoring focus prefix, the input grant routes, the run's
  structured problems, and the plugin logs route.
- `docs/data-sources.md`: inputs, bindings, derived source rules, and the new error codes.
- `docs/security/plugin-node-realm.md`: what a loaded plugin may read, and the input grant.
- `docs/plugins/distribution.md` and `docs/plugins/dev-loop.md`: input approval, and development mode
  for folder-installed node plugins.
- `docs/plugin-authoring/`: the manifest's `inputs`, permissions, the node half, testing, the scaffold,
  telemetry, and a new walkthrough page for derived sources.

## Verify before building

The paths here are hints. Before each phase, recheck its starting point against the code, because
the shipped code wins. Each phase ends with its own list.
