# Phase 5: the Add panel launcher

Status: proposed, October 5, 2026. Depends on [phase 3](./03-studio-shell.md). Works without
[phase 6](./06-docked-ai.md), but the **Draft it** path is best with the docked AI. Read the
[programme README](./README.md) first. The
[Panel Editor Review](https://claude.ai/artifact/EA1H3DdvVEUd9WTNg5MWyf) shows the launcher in
"The launcher (Add panel)".

## Goal

**Add panel** opens one small screen that answers "what do you want to see?" You either type a
request, which starts the AI, or pick a source and account, optionally with a starter panel, which
opens the studio already filled in. Unfinished drafts are listed openly. The launcher replaces the
**Pick data** and **Describe it** buttons that phase 3 leaves in the empty preview.

## Starting point

- **Add panel** buttons: the Home header and empty state in
  `packages/client-core/src/features/workspaces/Home.tsx`, and the grid's own button in
  `PanelGrid.tsx`. All of them open `DashboardPanelHost` with an empty session.
- The source and account picker lives inside `SourceQueryEditor`
  (`packages/client-core/src/features/dataSources/SourceQueryEditor.tsx`). With `pickSourceAccount`,
  it lists one entry per source and usable account. It reads the catalog through
  `dataSourceCatalogOptions` and saved queries through `queriesClient(...).list`.
- Sources can return up to 10 `starterPlans` from `describe`
  (`packages/protocol/src/data/dataSources.ts`). The host validates each one before showing it.
  As of October 5, 2026, no source returns any: the only references are the schema, the
  plugin contract in `packages/plugin-types/src/contracts/data.ts`, and the editor.
- Built-in sources include Workspace tasks
  (`packages/node-core/src/server/dataSources/coreTasks.ts`), Local branches and Local worktrees
  (`localGitSources.ts` in the same folder), and Agent usage records
  (`plugins/agents/src/shared/usageRegistration.ts`). GitHub pull requests are in
  `plugins/github/src/server/data/pullSourceHandler.ts`.
- After phase 1, the editor no longer resumes the newest draft silently. It shows a prompt instead.
- A plugin region (`PanelRegion` in `region.ts`) can restrict `sources`, require a `fieldRole`, and
  restrict `views`. After phase 3, the studio receives the region.

## Requirements

### Opening

1. Every **Add panel** button opens the launcher, a `Modal size="lg"` titled **Add panel**. The
   launcher is a component in the studio folder, `PanelLauncher.tsx`. It returns one of three
   results to `DashboardPanelHost`, which then opens the studio:

   ```ts
   type LaunchResult =
     | { kind: 'describe'; request: string }
     | { kind: 'source'; reference: QueryReference; starter?: PanelPlan }
     | { kind: 'draft'; dashboardId: string }
   ```

2. Opening an existing panel with **Edit…** skips the launcher.

### Describe

3. The top of the launcher is a request box with the placeholder "Describe what you want to see".
   Use the kit `Composer` with `submitLabel="Draft it"`, so it behaves like the task composer:
   Enter submits and Shift+Enter adds a line. The model and backend choice shows as a small
   control under it, read from and saved with `readGeneratePick` and `saveGeneratePick`, as
   `AuthoringConversation` does today.
4. **Draft it** returns `{ kind: 'describe', request }`. The studio opens with an empty plan whose
   `request` is the text, the AI open, and the first turn already sent. Until phase 6, "AI open"
   means the AI modal.
5. Under the box, show up to four suggestions as `Chip`s. A suggestion fills the box and doesn't
   submit. Take them from the titles of starter plans of sources the person can use. If none exist,
   show no chips. Don't hard-code example requests: one that needs a source the person hasn't
   connected promises something the panel can't do.

### Start from data

6. Below a divider, "or start from data", list sources as one row per source and account pair, plus
   saved queries, with a search field. Reuse the picker logic from `SourceQueryEditor` with
   `pickSourceAccount`. Extract it into a shared function or component rather than copying it. Each
   row reads "*Source* · *Provider* · *Account*", such as "Pull requests · GitHub · Work".
7. In a plugin region, list only sources the region allows: `region.sources` when it's set, and the
   region plugin's own sources when neither `sources` nor `fieldRole` is set. That's the same rule
   as `regionAllows`.
8. Selecting a row describes the source and expands the row to show its starter plans as buttons,
   each titled with the plan's title and showing the first line of `describePanelPlan` as its
   description, plus **Blank**. Validate starters through `client.validate` before showing them, as
   the old editor does.
9. Picking a starter returns `{ kind: 'source', reference, starter }`. Before returning, set every
   source in the starter whose plugin and source match the picked row to the picked account's
   scope (`connectionId` and reach parameters). A starter must never carry an account of its own.
10. Picking **Blank** returns `{ kind: 'source', reference }`. The studio creates the source and
    applies the default column rule from phase 1: fields with a display role, or the first six.
    Then it selects the **Columns** part, so the person sees what they got.

### Drafts

11. When unpublished drafts exist, show "Unfinished" under the source list, with up to three of
    them, newest first. Each row has the title, "edited *relative time*", **Continue**, and
    **Discard**. **Continue** returns `{ kind: 'draft', dashboardId }`. **Discard** deletes the draft
    through `client.delete` after a confirm. If more than three exist, add "and *N* more", which
    expands the list.
12. A draft belongs to the scope it was made in. List only drafts from the current workspace.

### Starter plans for built-in sources

13. Add starter plans to the sources acorn owns, so the launcher has something to show out of the
    box. Each starter is a complete `PanelPlan` with no account in its scope:
    - Workspace tasks: "Tasks updated this week", and "Tasks with uncommitted changes" if the source
      exposes modified and untracked counts.
    - Local worktrees: "Worktrees with uncommitted changes".
    - Agent usage records: "AI cost this month by task", summarized by task with a sum of cost.
    - GitHub pull requests: "My open pull requests", "Waiting for my review", and "Ready to merge",
      each only if the fields it filters on exist on the source.
14. Put each source's starters next to its description, in the plugin or Node module that describes
    it. A test per source parses every starter with `panelPlanSchema` and runs `validatePanelPlan`
    against the source's own description.

## Out of scope

- Starter plans for third-party plugins. The contract already allows them. Document how in
  `docs/plugin-authoring.md`, and leave the plans to plugin authors.
- Remembering the last source picked.

## Tests

- `PanelLauncher.test.tsx` (`hosts` tier): each of the three results; region filtering; the
  account substitution in requirement 9; drafts listing and discarding.
- Starter tests per source, as in requirement 14.

## Check it in the app

Open **Add panel** on Home in a `dev:agent` session. Pick **Workspace tasks**, then **Tasks updated
this week**, and check that the studio opens with a working preview. Close it, open **Add panel**
again, and check that the draft shows under "Unfinished". If the session has a model backend, type
a request and check that the studio opens with the AI working on it.

## Docs to update

- `docs/dashboards/mapping-and-editor.md` § The generated editor: the launcher and its three paths.
- `docs/data-sources.md`: which built-in sources ship starter plans.
- `docs/plugin-authoring.md`: how a plugin source adds starter plans, and that the host substitutes
  the account.

## Verify before building

- The catalog query (`dataSourceCatalogOptions`) is cheap enough to run every time the launcher
  opens. If it isn't, cache it per Node for the session.
- Whether the catalog descriptor carries starter plan titles, or only `describe` does. If only
  `describe` does, requirement 5's chips come from sources already described in this session, and
  may be empty the first time.
- The field names on the GitHub pull request source for requirement 13: author, review request,
  and merge readiness.
- `docs/data-sources.md` exists and owns the source contract.
