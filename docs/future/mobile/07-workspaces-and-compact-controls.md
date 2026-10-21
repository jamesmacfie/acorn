# Phase 7: open on workspaces, and fit the agent pane on a phone

Date: October 22, 2026. Status: built. Needs every earlier phase. [Completion](#completion) lists where it departs from this design.

## Goal

The phone opens on a list of workspaces instead of every task on the Node. A workspace has a
dashboard, which stays empty in this phase, and its tasks, with what waits on someone at the top of
them. The agent pane fits on a phone: controls are smaller, the header is one row, the composer's
settings fold away, and the keyboard stays down until someone taps the message box.

This phase also settles how a component draws differently on the desktop, on a phone, and in the
terminal. Read [draw differently on a phone](#draw-differently-on-a-phone) before you change a
component for a phone.

## Starting point

- `Home.tsx` draws **Needs you**, then every task grouped by workspace, with **New task** in the top
  bar. `TaskScreen.tsx` draws one pane over a bottom bar of the task's panes. **Back** always goes to `/`.
- With `core.workspaces` off, each project owns one workspace with the same ID and name
  ([workspaces and tasks](../../workspaces-and-tasks.md#workspace-and-project)). A workspace ID is a
  valid route in both modes, and `createWorkspaceWords` says whether to call it a workspace or a
  project.
- An attention item names a task, a project, or neither (`AttentionItem` in
  `host/registries/rail/attention.ts`). The two built-in sources, agents and workflows, only raise
  items that name a task.
- `narrow.css` sets `--control-h`, `--control-h-sm`, and `--control-h-xs` to 44px. Every small and extra
  small button on a phone is as tall as a full-size one, which is why the toolbars and selects look
  large.
- Two values describe where the client runs. `HOST` (`kit/tokens/support.ts`) is the renderer, `dom`
  or `tui`. `FormFactor` (`@acorn/protocol` chrome surfaces) is the screen, `desktop`, `narrow`, or
  `tui`. The kit's `Only` reads `HOST` alone, so a plugin can hide something in the terminal but can't
  tell a phone from a desktop without calling `formFactor()` itself.
- Every `role="dialog"` modal and every `Drawer` is a full-screen sheet on a phone (`overlays.css`).
  A `Popover`, `Menu`, `Picker`, or `Select` still floats beside its trigger.
- The agent pane's header (`AgentDetailHeader` in `sessions/AgentPane.tsx`) is one toolbar: the
  provider mark, the session title, up to four chips, the state, **Stop**, the session menu, the usage
  button with a label per harness, and **New**. The phone's top bar above it already shows the task
  title and state.
- The composer (`composer/AgentComposer.tsx`) draws the model and effort selects, the chips for
  attachments and context, a note about the automatic context, the message box, and a toolbar of
  **Goal**, **Attach**, **Context**, **Insert**, a plugin slot, the context preview, the
  **Shift+Enter for newline** hint, **Steer**, and **Send**. Enter sends. `AgentPane.tsx` passes
  `autoFocus={!archived()}`, so opening a session raises the phone's keyboard.

## The design

### Draw differently on a phone

A difference falls in one of two places:

1. **The shape of a control belongs to the kit.** When a control needs a different shape on a phone,
   the kit component changes it and no plugin does. This is the rule the terminal already follows:
   it draws a `Popover` as a block under its trigger, and the plugin never knows. Narrow is a
   projection of the `dom` host, the same way the layouts have narrow projections.
2. **What a plugin shows belongs to the plugin.** When the content itself should differ, such as a
   usage button with no words on it, the plugin says so with `Only`. `Only` takes `formFactors` beside
   `hosts`, so `<Only formFactors={['narrow']}>` draws its children on a phone only. Both props must
   match when both are given. It reads the same root attribute that `isNarrow()` reads, because the
   kit can't import `infra/platform`. The terminal's `Only` in `apps/tui/src/kit/pixels.tsx` takes the
   prop too and matches `tui`.

Nothing reads the window width, as before. A plugin that draws in a worker gets `formFactors` through
the tree, since the prop is a plain list.

Write the rule into [the closed kit](../../ui-design/closed-kit.md) when this ships.

### Open overlays as sheets

On a phone, `createAnchoredPopover` (`kit/lib/controls/anchor`) skips the anchored position and opens
its surface as a sheet along the bottom edge, full width, over a backdrop. A tap on the backdrop or
**Escape** closes it, as an outside click does on the desktop. `Popover`, `Menu`, `Picker`, and
`Select` all draw through it, so every plugin's dropdowns change at once. A caller's `minWidth` and
`placement` don't apply to a sheet. The sheet stops above the keyboard with `--keyboard-inset`.

Tooltips aren't popovers and don't change.

Some small popovers may read as heavy in a sheet. Change those afterwards, one at a time, with a
prop the caller sets, rather than holding this rule back for them.

### Size controls for a thumb

`narrow.css` draws controls at 40px, 32px, and 28px for `--control-h`, `--control-h-sm`, and
`--control-h-xs`. A small or extra small control keeps a 44px tap area through an invisible
pseudo-element centered on it, in `primitives.css`, so the visible size drops and the target meets
Apple's 44-point guideline. Toolbars on a phone get enough gap that two neighbors' tap areas don't
overlap. `styles/tokenAxes.test.ts` pins the sheet's values, so update it.

### Pick a workspace

| Route | What it shows |
| --- | --- |
| `/` | The workspaces in the Node's order, or the visible projects when `core.workspaces` is off. Each row has its `WorkspaceIcon`, its name, its task count, and the number of items waiting in it. |
| `/w/:workspaceId` | The workspace's dashboard. Empty in this phase. |
| `/w/:workspaceId/tasks` | **Needs you** for the workspace, then its tasks grouped by project. **New task** is in the top bar. |
| `/t/:taskId/:paneId?` | As before. **Back** goes to the tasks of the task's workspace. |

The two workspace routes share a bottom bar of **Dashboard** and **Tasks**, drawn like the task
screen's bar of panes. The **Tasks** button carries a marker with the waiting count, so someone who
lands on the empty dashboard can see that something waits.

A task route keeps no workspace in it. **Back** reads the workspace from the task's project with
`workspaceForProject`, so a link from a notification still lands somewhere sensible. **New task**
offers the workspace's visible projects, as the desktop offers the active workspace's.

The top bar's title is the workspace's name. On `/` it is the plural from `createWorkspaceWords`.

### Show what needs you in the workspace

The inbox stays one `createAttentionInbox`. A workspace's **Needs you** filters its rows: a row with a
task belongs to that task's project's workspace, and a row with only a project belongs to that
project's workspace. A row that names neither belongs to the Node, so the picker draws those under
its list. No built-in source raises one today.

### Fit the agent header on one row

On a phone, `AgentDetailHeader` draws one row:

1. The provider mark and the session title, which truncates.
2. The state, as its icon with no words.
3. **Stop**, as an icon button, drawn only while `canStopAgent` or `canStopSubagent` is true.
4. The usage button: the gauge, then one status dot per harness, with no labels or percentages. It
   opens `AgentUsageSection` in a sheet, from the overlay rule above.
5. **New**, as a plus icon that opens the same picker.
6. The session menu. The workflow, parent, background command, and custom agent chips move into it
   as rows above the session actions, and keep their presses.

The plugin slot `AGENT_SESSION_HEADER_POINT` stays on the row. The desktop and the terminal draw the
header as before.

### Fold the composer's controls

On a phone the composer starts folded. Folded, it shows the message box, one line of summary, a
toggle, **Steer** while the turn takes steering, and **Send**. The summary names the selects'
current values and counts what is attached, such as "Opus · high · 2 attached", so nothing hidden is
out of mind. Unfolded, it adds the selects, the transcript controls, the chips, the automatic
context note, and the toolbar's other buttons.

Use the kit's `Fold`. Keep whether it's open in a persisted state slice for the device, beside
`composerExpansionSlice` in `composerPrefs.ts`. Adding an attachment or a context reference unfolds
it, so the chip that names it can be seen and removed.

### Leave the keyboard down

On a phone:

- `AgentPane.tsx` passes `autoFocus={!archived() && formFactor() !== 'narrow'}`. The keyboard rises
  when someone taps the message box.
- The return key adds a new line. The composer leaves `onSubmit` off `MentionTextarea`, which keeps
  Enter as a newline, and **Send** is the one way to send. Enter still picks a highlighted suggestion.
- The **Shift+Enter for newline** hint isn't drawn.

## Steps

1. Add `formFactors` to both `Only` components, with tests in each package, and update the plugin API
   surface snapshot.
2. Open overlays as sheets in `createAnchoredPopover`, with a narrow test beside `Popover.test.tsx`.
3. Change the narrow control sizes and add the tap area.
4. Add the picker, the workspace screens, and the workspace's **Needs you** in `apps/mobile`. Point
   **Back** at the task's workspace. Update the route tests.
5. Change the agent header for a phone.
6. Fold the composer, and change its focus, return key, and hint for a phone.
7. Check every popover that a built-in plugin opens on a phone at 390 by 844, and list the ones that
   look wrong in the completion note.

Steps 1 to 3 change client-core and can ship alone. Steps 5 and 6 need step 1.

## Acceptance

Check in Chromium at 390 by 844 against a throwaway standalone Node with two workspaces, and again
with `core.workspaces` off:

1. The app opens on the workspaces, or on the projects with workspaces off, and each row shows its
   waiting count.
2. A workspace opens on its empty dashboard. **Tasks** shows its marker while something waits, and
   lists only that workspace's waiting items and tasks.
3. **Back** from a task returns to that task's workspace.
4. A small button measures 32px tall and answers a tap 6px outside its edge.
5. The usage button, the session menu, **New**, and the model select each open as a sheet.
6. The header fits on one row with a long session title, and the chips appear in the session menu.
7. Opening a session leaves the keyboard down. Return adds a line, and **Send** sends.
8. The composer opens folded, the summary names the model, and attaching a file unfolds it.
9. The desktop and the terminal draw the agent pane as before, and their tests pass unchanged.

## Completion

Built on October 22, 2026, and checked in Chromium at 390 by 844 against two throwaway standalone
Nodes, one with two workspaces and one with `core.workspaces` off. Every acceptance item passed. Where
the build departs from the design:

- The composer's fold state is a page-lifetime signal in `composerPrefs.ts`, not a persisted state
  slice. The phone shell restores no slices, so a slice would never be read back on the one screen
  that folds.
- The `Picker`'s list has its own class, `repo-picker-popover-fixed`, so the narrow sheet rule names it
  beside `.ui-popover`.
- The plugin API surface snapshot lists names only, and `Only` kept its name, so it didn't change.
- The phone draws `WorkspaceIdentity` through a client-core entrypoint of its own, so the entrypoint
  cap in `tools/arch/boundaries.test.ts` rose to 211. The feature's `public.ts` can't take it, because
  node-environment tests import that file and can't parse JSX.
- A chip with no press, such as the custom agent's, is a `Menu.Label` row in the session menu. It
  reads as a small heading.
- On a Node with `core.workspaces` off, each project's workspace has an ID of its own, not the
  project's. The routes don't depend on that.

Every popover that Agent, Git, and Context open on a phone opened as a sheet and closed from its
backdrop and from **Escape**: **New**, the session menu, usage, the composer's selects, Git's view
options, remote actions, commit options and message model, and Context's session picker. Notes and
Editor open none. None looked wrong. Git's message model popover holds two selects, so picking one
opens a second sheet over the first.
