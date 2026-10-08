# Group projects later

Date: October 8, 2026

Status: Proposed. Implementation not started.

This product requirements document lets a Node that keeps each project separate switch to grouped
workspaces after first run. The switch goes one way. A grouped Node still can't go back to separate
projects. Use this page to build and verify the change.

## Problem and outcome

The first-run wizard's **Layout** step asks whether to keep each project separate or group projects
into workspaces. The Node stores the answer in `core.workspaces` and refuses every later change.
Someone who starts with separate projects and later wants to group them has no way to do it.

Going from separate to grouped moves no data. With workspaces off, every project already owns a
workspace with its own name, Home boards, notes, saved queries, workflow definitions, and Linear and
Rollbar links. Turning workspaces on only lifts the rule that keeps each workspace to one project.
Those workspaces become ordinary grouped workspaces, each holding one project, and nothing changes
owner.

The outcome:

- A person on a separate-projects Node can turn on grouping from Settings.
- Every open client, desktop or terminal, switches its wording from "project" to "workspace" without
  a restart.
- The **Layout** step tells first-time users that they can group projects later, but can't separate
  them again.

## Scope and decisions

1. **One direction only.** The Node accepts `core.workspaces` changing from `off` to `on`. It keeps
   refusing `on` to `off` with 409 `workspaces_fixed`. Going back would split workspaces that hold
   several projects, and a workspace's data has no rule for which project inherits it.
2. **No data moves.** The switch writes one preference row. It doesn't create, rename, merge, or
   delete a workspace or a project. Workspace IDs stay the same, so view memory, `last_workspace`,
   the optional workspace rail, and workspace icons keep working.
3. **The person confirms.** The Settings control states that the switch can't be undone and asks for
   a second press before it writes, using the kit's arm-to-confirm pattern.
4. **Grouped rules apply from the next request.** The Node reads the mode on every request
   (`nodeWorkspacesMode` in `packages/node-core/src/server/workspacesMode.ts`), so its separate-mode
   refusals lift as soon as the row changes. After the switch, a Node behaves exactly like one that
   chose grouped at first run:
   - Workspace create, rename, and delete are allowed.
   - Projects can move between workspaces. As on any grouped Node, a moved project's
     workspace-owned data stays behind with the workspace.
   - Renaming a project no longer renames its workspace. Names can drift apart from then on.
   - Deleting a project leaves its workspace in place, possibly empty.
   - Adding a project without naming a workspace puts it in Default, and the Node creates Default
     on first use.
5. **Every client hears about it.** The Node publishes a change event after it commits the switch,
   so clients refetch preferences instead of waiting for a stale cache to expire. See
   [data flow](#data-flow-and-contracts).
6. **Desktop control only.** The terminal client follows the change but doesn't offer the switch.
   A Settings page on the terminal client is a separate decision.
7. **Out of scope:** grouped to separate in any form, including a Node whose workspaces each happen
   to hold one project. Moving a project together with its workspace-owned data is also out of
   scope.

## User experience

### Settings

With workspaces off, Settings → **Projects** (the Overview page, which is labelled "Projects" in that
mode) gains a section at the foot of the page:

- Heading: **Group projects into workspaces**.
- Body: "Put several projects in one workspace so they share a task list, notes, and dashboards.
  Each project you have now becomes its own workspace. You can't switch back to separate projects."
- Control: a **Group projects** button that arms to "Group projects? This can't be undone." and
  writes on the second press.
- While the write is in flight, the button is disabled. If the write fails, the section shows the
  Node's message and the button returns to its first state.

With workspaces on, the section doesn't render. A grouped Node has nothing to switch to.

After the write succeeds, the page relabels itself from "Projects" to "Workspaces" and the topbar
switcher, the workspace rail, the command palette, and the shortcuts page change their wording. No
notice or reload is needed. The change on screen is the confirmation.

### First-run wizard

The **Layout** step's muted line becomes "Pick how acorn organizes your projects. You can group
projects into workspaces later, but you can't separate them again." Its saved-answer line follows
the same rule:

- Separate: "Your projects stay separate. You can group them into workspaces later in Settings."
- Grouped: "Your projects are grouped into workspaces. You can't switch back to separate projects."

Change this wording last, in the same change that ships the Settings control, so the wizard never
promises a switch that doesn't exist yet.

### Terminal client

The terminal client's chrome reads the mode from the preferences query
(`apps/tui/src/chrome/Shell.tsx`). After the change event and refetch, it shows workspace wording
and the workspace step in its setup flow behaves as on any grouped Node. No terminal control is
added.

## Architecture and ownership

| Concern | Owner |
| --- | --- |
| Which mode changes are allowed | `writePreference` in `packages/node-core/src/server/core/prefs.ts` |
| Publishing the change | The Node's preference write path, after the transaction commits |
| The event's name and payload | `packages/protocol/src/transport/nodeEvents.ts` |
| Refetching preferences on the event | The client's node event handling in `packages/client-core/src/infra/node/` |
| The Settings section | `packages/client-core/src/features/workspaces/`, drawn on the Overview page |
| Wording by mode | `workspaceWords` in `packages/client-core/src/features/workspaces/words.ts`, unchanged |
| The wizard's wording | `plugins/onboarding/src/client/OnboardingWizard.tsx` |

### Data flow and contracts

1. Settings sends `PUT /v1/core/prefs` with `{ key: 'core.workspaces', value: 'on' }`. That's the
   same route and body the wizard uses. No new route is needed.
2. `writePreference` runs in one transaction:
   - Stored `off`, value `on`: write the row.
   - Stored `on`, value `off`: refuse with 409 `workspaces_fixed`. Change its message to "Grouped
     workspaces can't be switched back to separate projects."
   - Stored equal to value: write as today.
   - Unset: keep today's rules, including the refusal of `off` when projects exist.
3. After commit, the Node publishes the change event to every connected client.
4. Each client invalidates its preferences query for that Node. `createWorkspacesMode` and the
   terminal shell's `mode` memo derive `on`, and every reader redraws.
5. The chrome surface data's `workspacesMode` (`packages/protocol/src/chrome/surfaces.ts`) changes
   for plugins that read it.

The change event is a decision this work has to make. Two options:

- **A dedicated event,** such as `workspaces-mode:changed` with `{ mode: 'on' }`. It's explicit and
  carries no unrelated meaning. It needs an entry in the node events list, the client's event map,
  and the frame channel list if plugins may subscribe.
- **A general `prefs:changed { key }` event.** Other Node-scoped preferences have the same stale-cache
  gap, so this fixes it once. It's broader than this task needs.

We recommend the dedicated event. It closes the gap this feature opens without deciding the general
preference-sync design as a side effect.

## Implementation sequence

1. **Node rule.** Allow `off` to `on` in `writePreference`. Keep every other refusal. Update the
   message for `on` to `off`. Add route tests for each transition, including a refusal that leaves
   the stored value unchanged.
2. **Change event.** Add the event to the protocol, publish it after the preference transaction
   commits, and refetch preferences on it in client-core. Test that a second client sees the new
   mode without a manual refetch.
3. **Settings section.** Add the section to the Overview page while the mode is `off`, with
   arm-to-confirm, a disabled in-flight state, and the Node's error on failure. Test both modes,
   the confirm, and a failed write.
4. **Live wording check.** In a `dev:agent` session started with `--workspaces off`, switch from
   Settings and confirm that the topbar, rail, palette, Settings labels, and shortcuts page change
   without a reload. Then confirm that creating, renaming, and deleting a workspace and moving a
   project all work.
5. **Wizard wording and docs.** Change the **Layout** step's lines. Update the wizard tests that
   match them. Update the docs listed below.

Steps 1 and 2 can land together. Step 5 must not land before step 3.

## Acceptance and verification

- A separate-projects Node switches to grouped from Settings after one confirm, and the stored
  `core.workspaces` is `on`.
- Workspace and project rows are byte-identical before and after the switch.
- A grouped Node refuses `off` with 409 `workspaces_fixed`, from any client and from the API.
- An open terminal client on the same Node shows workspace wording within one event round trip,
  with no restart.
- After the switch, a new workspace can be created and a project moved into it.
- The Settings section doesn't render on a grouped Node.
- The **Layout** step's wording matches [First-run wizard](#first-run-wizard).
- `pnpm lint`, and `pnpm test --filter` for `@acorn/node-core`, `@acorn/protocol`,
  `@acorn/client-core`, `@acorn/tui`, and `@acorn/plugin-onboarding`, pass. So does
  `pnpm --filter @acorn/arch-tests test`.

## Docs to update when this ships

- `docs/workspaces-and-tasks.md`: replace "Once stored, the mode cannot change" with the one-way
  rule and why the reverse is refused.
- `docs/workspaces-and-tasks/projects.md` § The first-run wizard: the new **Layout** wording, and a
  short description of the Settings switch.
- `docs/api-reference/websocket.md` and `docs/plugins/events.md`, for the new event.
- `docs/future/README.md`: mark this page implemented, or retire it.

## Verify before building

Paths and names here are hints. Check each before you rely on it:

- `writePreference` is still the only path that writes `core.workspaces`, apart from
  `settleWorkspacesMode`, which only writes when the row is unset.
- No Node code caches the mode across requests. `nodeWorkspacesMode` is read per request in
  `projects.ts`, `projectDeletion.ts`, and `routes/projects/workspaces.ts`.
- No client reader assumes the mode never changes after it first settles. Start with
  `createWorkspacesMode` and its callers, `fleetWorkspaces.ts`, `apps/desktop/src/client/App.tsx`,
  and `apps/tui/src/chrome/Shell.tsx` and `Setup.tsx`.
- Plugins that read `workspacesMode` from chrome surface data handle a change while mounted.
- The Overview page's title and rail label recompute from the mode reactively, through
  `settingsCategoryLabel` and `settingsPageForMode`.
- How the client routes node events to query invalidation, and where `workspace:changed` is handled,
  so the new event follows the same path.
