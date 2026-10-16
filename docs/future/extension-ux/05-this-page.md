# Phase 5: This page, for an issue or a project site

Date: October 16, 2026. Status: done on October 16, 2026. Depends on [phase 1](./01-navigation.md).

## Completion note

Landed on October 16, 2026. The issue card in **This page** is the kit's `Card`: a head row with the
plugin's logo, the key, the connection, the title, and an arrow icon button for **Open in Acorn**,
then the project, then **Create task** and **Run workflow**. Picking a workflow adds its picker, one
`Field` per input, **Start run**, and **Cancel**. **Create task** opens the new task on **Agents**,
where the item waits as a chip. **Start run** opens **Runs** with the run chosen, as before. The
project site card is a grouped kit `Picker` over Home's task rows. `waitingContext` is gone.
[Handoffs](../../browser-extension/handoffs.md), [project sites](../../browser-extension/project-sites.md),
[pages matched to tasks](../../browser-extension/task-pages.md), and
[workflows](../../browser-extension/workflows.md) are updated, and so are the site pages that teach the
card.

Decisions and deviations:

- The kit's `Picker` gained `group` on its data rows. Rows of a group come together, and the label
  shows over the first one the filter keeps, in both the desktop and terminal hosts. Go to task's
  group label now uses the kit's `.repo-picker-group` rule from `primitives.css`.
- The kit's `Field` gained `required`, a red asterisk after the caption, hidden from screen readers,
  because the control says it. The terminal host prints ` *`.
- The pending item is stored per task under `pendingItem:<nodeId>:<taskId>`, through
  `loadPendingItem`, `savePendingItem`, `dropPendingItems`, and `changedPendingItem` in
  `localState.ts`. `Workspace.tsx` reads it for the shown task and follows storage changes. The next
  conversation opened or started in that task takes it into its draft. It's dropped by ×, by joining
  a draft, and when a task leaves the Node's task list while the panel is open. A task archived while
  the panel is closed leaves its item in storage. Prune on panel open if that ever matters; the
  background's first empty task list is why it doesn't today.
- The task chip's **New chat about this page** stores its link the same way, so it waits on that
  task's **Agents** tab. Without a page task, it goes Home and keeps nothing.
- The chip's text is the composer's own, such as **Item · Fix the flaky test**, so it reads the same
  before and after it moves into the composer. A `PageCapture` has no item key or plugin, so the chip
  shows neither, and its icon is by kind: a document for an item, a link for a page.
- The plugin's logo shows only for the kit's own marks, such as GitHub's. A plugin registers its
  marks in the desktop's client, which the extension doesn't load, so Linear's issue shows a document
  icon. A `glyph` on the handoff descriptor would fix that, and needs its own manifest change.
- Workflow definitions have no description, so **Run workflow**'s rows show only names.
- **Run workflow** reads the project's workflows as soon as the card shows a startable item, so the
  picker opens on the list. The chip's **Start workflow…** opens the card on the first workflow.
- An item with linked tasks draws each as This page's task row, which opens the task. **Chat** and
  the context it carried are gone; the task's own page row already opens it.
- The card has no **Dismiss**, so Home's once-per-page lookup guard went too. Home looks the item up
  each time it shows a matching page. **Look up in Acorn** remains for several handoffs on one page
  and for an offline Node.
- The site card's tasks come from the Node's task list, `tasks.pages`, filtered by project, not a
  `tasks.list` read, so its rows are Home's `TaskRow` with the agent mark and the tab switch. The
  sidebar no longer calls `tasks.list`, and `BridgeTask` is no longer exported. The operation stays in
  the bridge; drop it in a cleanup.
- `TaskRow.tsx` holds `TaskRow` (Home's list and the site card) and `PageTaskRow` (This page and the
  linked tasks).
- `OpenInAcorn` is the kit's `Button`, or `IconButton` with `iconOnly`. The kit takes only web links
  as an `href`, so a press follows the `acorn://` link through `followAcornLink`, which the ⋯ menus
  share. That changes the plugin panel's **Open in Acorn** from a styled link to a kit button too.
- The pickers have names: **Project**, **Item**, **Run workflow**, and **Workflow**, so
  `pnpm dev:extension:ui pick` and the tests find them.

Sidebar-only, so a plugin can't reach it: the card's layout rules in `sidebar.css` (`.item-head`,
`.item-id`, `.hint`, `.divider`, `.pending-item`, and the This page caption width), and the
`TaskRow`, `PageTaskRow`, and `OpenInAcorn` components, which live in the extension, not the kit.

For later phases:

- Phase 6: the pending chip is at the top of the **Agents** section in `Agents` in `Home.tsx`, from
  `pendingItem` and `dropPendingItem`. Move it into the empty state there.
- Phase 7: `CAPTURE_NAMES` is exported from `Composer.tsx` for the chip's text. Keep the two in step.
- Phase 12: the start chip's choice still arrives as `start` on `PageHandoff`; `workflow` now means
  "open on the first workflow".
- Tests: `Handoff.test.tsx` has `card`, `pendingItem`, `resolvedUrls`, and `chatAndSend`.
  `ProjectSites.test.tsx` has `siteProject`, `projectGroups`, and `suggestedOptions` for the grouped
  picker.

## Goal

Turn an issue into a task and a chat in three clicks. An issue no task holds shows one card on Home
with one main action, **Create task**, and a second, **Run workflow**. After **Create task**, the
task opens with the issue attached to its first chat, where the person can see it and remove it. A
page on a project's site shows that project's tasks, with the matching projects first in the picker.

## In the prototype

- Scenarios: **An issue with no task**, **Run a workflow on it**, and **A project site**. In the
  first, click **Create task**. In the second, click **Start run**. In the third, pick **web-app**.
- Notes: `handoff` at line 1297, `handoff-wf` at line 1300, and `site` at line 1302.
- Code: `handoffCard` at line 887 draws the issue card, with and without a workflow chosen.
  `siteCard` at line 909 draws the project site card. `createFromItem` at line 1565 shows what
  **Create task** and **Start run** do. The `hproject`, `hwf`, and `site` cases of `pickerSpec` at
  line 1080 list each picker's groups.
- Today: `references/extension-ux/today/10-home-handoff-dark.png`,
  `11-home-handoff-workflow-dark.png`, and `12-home-site-dark.png`.

## Starting point

- `apps/extension/src/sidebar/Handoff.tsx` draws the card. It shows the page's address, a **Which
  one** select when the page has several items, the item, its linked tasks with **Open in Acorn** and
  **Chat**, a `handoff-start` select whose choice the button below repeats, a project select, a
  workflow select with its inputs, and **Dismiss**.
- The inputs already fill from the item through `prefillFromItem` from the workflows plugin, the
  desktop's rule.
- **Create task** leaves the item's context in `waitingContext` in `App.tsx`, "for the conversation you
  open next", with nothing on screen to say so.
- **Start workflow** calls `startedHandoffWorkflow` in `Workspace.tsx`, which opens Workflows.
- `SiteProject` in `apps/extension/src/sidebar/Home.tsx` draws the site card with a native project
  select, the project's tasks, and **New task**, which opens the project in the desktop app.
- `pageScope` in `apps/extension/src/pageScope.ts` works out the projects whose sites cover the page.

[Handoffs](../../browser-extension/handoffs.md) and
[project sites](../../browser-extension/project-sites.md) document today's behavior.

## The design

### The issue card

Inside **This page**, with the page's host at the right of the section header, one card:

1. A head row: the plugin's logo, then the item's key, such as **ENG-1234**, and the connection's
   name, such as "Linear · Acme", on one small line, then the item's title. At the right, an icon
   button with `arrow-up-right` and the label "Open in Acorn".
2. The project. With one tracking project, a muted line with a folder icon and its name. With
   several, a **Project** row with the kit's `Picker`, its rows under a group labelled "Tracks this
   issue".
3. Two buttons: **Create task**, solid with a plus icon, and **Run workflow**, plain with a chevron,
   which opens a `Picker` of the project's workflows, each with its description, under a group named
   for the project.

Remove the page's raw address, "No task in Acorn for this yet.", "The item waits for the first
conversation you open.", and **Dismiss**. The card sits in **This page** and takes over nothing else,
so it needs no dismissal. Keep the notice for a page you've left with typed inputs.

A page with several items keeps a choice between them. Make it a `Picker` in the head row in place of
the **Which one** select.

An item with linked tasks isn't "an issue with no task". With one linked task, draw phase 3's task
row in **This page**. With several, draw one row each.

### Run a workflow on the issue

Choosing a workflow adds, under a divider:

1. A **Workflow** row with the chosen workflow in a `Picker`, so the person can change it.
2. One field per input, labelled with a red asterisk when required. An input's description becomes
   its placeholder, not a line under the field. A filled input shows its value, so the person sees
   what goes in before they start.
3. **Start run**, solid with a play icon, and **Cancel**, which removes the workflow part.

**Start run** creates the task, starts the run, and opens the task on its Runs tab with the run
expanded. Remove "The workflow starts its agents straight away." **Start run** says it.

### After Create task

**Create task** creates the task and opens it on Agents. The task has no chat yet, so Agents shows
its empty state with the item as a chip, the plugin's logo and "ENG-1234 · title", with an ×, and
"Goes with your first message." under it. Phase 6 draws that empty state. Starting a chat moves the
chip into the composer, where it goes with the first message.

Keep the pending item per task, not as one `waitingContext` for "the conversation you open next". A
chip for task A must not attach to a chat in task B. Store it beside the task's draft in
`localState.ts`, so it survives the panel closing.

### The project site card

On a page of a project's site with no item, **This page** shows a **Project** row with a `Picker`:

- With several matching projects, the picker lists them first, under **Suggested for this page**,
  then the rest under **Other projects**. Each row shows the project's workspace.
- With one match, it's chosen.

Once a project is chosen, its tasks follow as phase 3's task rows, then a small **New task in Acorn**
button with `arrow-up-right`, which opens the project in the desktop app.

Remove the sentence that asks the person to choose.

## Changes

1. Redraw `Handoff.tsx` as the card above, with pickers for the item, the project, and the workflow.
   Remove the start select, the address line, the lookup sentences, and **Dismiss**.
2. Make an input's description its placeholder.
3. Open the task on Runs after **Start run**, with the new run expanded.
4. Replace `waitingContext` with a pending item kept per task in `localState.ts`, shown on Agents and
   attached to that task's first message.
5. Redraw `SiteProject` with the grouped picker and phase 3's rows.
6. Update `Handoff.test.tsx` and `ProjectSites.test.tsx`. Add tests for the pending item staying with
   its task, for the grouped project picker, and for the inputs' placeholders.
7. Update [handoffs](../../browser-extension/handoffs.md) and
   [project sites](../../browser-extension/project-sites.md).

## Acceptance

- On a Linear issue no task holds, **Create task** creates the task and opens Agents with the issue as
  a chip. Starting a chat and sending sends the issue as context.
- Removing the chip with × sends nothing extra.
- Creating a task for issue A, then opening task B, shows no chip in task B.
- **Run workflow** › **Fix an issue** fills **Issue** from the issue. **Start run** opens the new
  task's Runs with the run expanded.
- On a page two projects' sites cover, the project picker lists both under **Suggested for this
  page**.

## Risks

`waitingContext` lives only in memory today, so closing the panel loses it. A pending item kept in
storage outlives the panel, so clear it when its task's first message sends and when the task is
archived, or it waits forever.

The task chip's **New chat about this page** also fills `waitingContext`, through `showTask` in
`Workspace.tsx`. Move that path to the per-task item in the same change, or the chip's link loses its
place.
