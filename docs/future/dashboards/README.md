# Panel studio: creating, editing, and previewing dashboard panels

Status: proposed, October 5, 2026. Nothing built. This programme replaces the dashboards programme
that lived in this folder. Its workstreams 1 to 7 shipped by October 4, 2026, and its files were
removed on October 5, 2026; git history keeps them (commit `1d8c37913`).

Read this page before any phase. It says what's wrong, what we're building, the decisions already
made, the order of work, and how to check your work in the app. The
[Panel Editor Review](https://claude.ai/artifact/EA1H3DdvVEUd9WTNg5MWyf) is the design source:
screenshots of today's editor, the findings, and mockups of every piece below. Open it beside these
files.

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

Phases 1 and 2 can run at the same time. After phase 3, phases 4, 5, and 6 can run at the same time
if their owners agree who touches `inspectors.tsx` and `studioStore.ts` first. Phase 7's quick
edits can ship any time after phase 2.

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
- `docs/api-reference/core-routes.md`: the authoring focus prefix.

## Verify before building

The paths here are hints. Before each phase, recheck its starting point against the code, because
the shipped code wins. Each phase ends with its own list.
