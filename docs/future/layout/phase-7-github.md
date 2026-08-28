# Phase 7: github

Status: not started.

## Goal

Move the github plugin's five surfaces to layouts and kit trees on the direct path: the PR pane,
browse, the pull list, the ref panel, and the importer. The PR pane is the largest regular pane in the
product and proves `tabs` as a pane layout, `Timeline` with a `Composer`, nested `list-detail`, and
`DiffPane` with annotations from another plugin.

## Why this phase, and why now

After phase 6 every layout has been used by first-party code except `tabs` as a pane, and every slot
pattern except a `summary-badges` stack. github adds both on a pane whose behaviour is well tested and
whose data is mirrored, so regressions are visible. It goes before agents because it is large without
being performance-sensitive.

## Scope

In: `plugins/github/src/client/` rewritten against the kit. Behaviour unchanged. `importer.css` and
the `styles/` directory deleted.

Out: the node half, content links, the mirror, the footer slot badge (a descriptor).

## Per surface

### PR pane (`PullDetail`, `PullSummary`, `ChecksPanel`, conversation, `DiffForPull`)

Layout `tabs` with Overview, Conversation, Files.

- Overview: `Heading` with `#number` eyebrow; `Facts` (author, branch, age, reviewers); a `Toolbar`
  of actions (merge, draft, auto-merge, reopen) with `ConfirmButton` where destructive; the conflict
  `Alert`; labels as a `ChipRow` with a `Picker`; checks as a `Section` of `Row`s with `status`;
  `Slot point="summary-badges" mode="stack" max={4}` for CI, deploys, and stacks from other plugins.
- Conversation: layout `header-body-footer` inside the tab; body is a `Timeline` of `Card`s with
  `Avatar` and `Markdown`; footer is a `Composer` (the mention textarea folds into `Composer`).
  Review comments on files link to the Files tab by `onSelect`.
- Files: `list-detail`; list is `TreeRow`s with add and remove `badge`s; detail is `DiffPane` with
  `annotations` from `github:diff-line` (review threads from github itself, and any contributor).

Accepted differences: the label picker and reviewer picker become `Picker` nodes; the conversation
loses its custom entry layout for the `Card` layout; the diff navigator is a `TreeRow` list rather
than a flat file list.

### Browse (`GithubBrowse`)

Layout `list-detail` whose detail region is another `list-detail`: repos, then navigator, then detail
or the compose form. The compose form (`CreatePullForm`, `ComparePreview`) is `Field`s, a `Picker` for
branches, and `DiffPane` for the preview.

### Pull list (`PullList`)

A `Tabs` node over a `Row` collection with `RowActions` and `StatusDot`, virtualised by the kit's
collection host rather than the plugin's own scroller. Collection state (active, selected, offset)
comes from phase 2 and replaces `reviewScrollRestoration.ts` and `reviewViewState.ts` where they
tracked position.

### Ref panel (`PullRefPanel`)

`Heading`, `Facts`, `StatusDot`, and the host's task-link control; a tree in the box the host draws.

### Importer (`GithubImporter`)

Layout `wizard`, sharing onboarding's steps where they overlap.

### Shortcuts (`Shortcuts.tsx`, `registerKeybindings`)

Every hand-registered keybinding becomes a layer binding on the pane or a region through the keymap
(phase 2). The file shrinks to command declarations.

## Code touched

- `plugins/github/src/client/{PullDetail.tsx,PullSummary.tsx,PullList.tsx,GithubBrowse.tsx,
  DiffForPull.tsx,DiffView.tsx,ComparePreview.tsx,CreatePullForm.tsx,PullRefPanel.tsx,
  GithubImporter.tsx,Shortcuts.tsx,slotContribution.tsx}` and the `checks/`, `createPull/`,
  `pullDetail/`, `pullList/` directories.
- `plugins/github/src/client/{importer.css}` and `styles/`: deleted.
- `plugins/github/src/client/{reviewScrollRestoration.ts,reviewViewState.ts}`: reduced to what the
  collection store does not cover.

## Tests

- Existing github client tests (`queries.test.ts`, `prefetch.test.ts`, `contentLinks.test.ts`,
  `pullTasks.test.ts`, `routes.test.ts`, `reviewViewState.test.ts`) pass or are updated where the
  collection store now owns position.
- The PR pane renders in the jsdom tier with a fixture PR through each tab.
- A test contributor's marks appear on the Files tab diff stamped with its id.
- Keyboard: every action on the PR pane is reachable without a pointer.

## Docs owed

- `docs/github-integration.md` § "Tasks and references" and § "Actions and logs": layouts and slots.
- `docs/diff-rendering.md`: the annotation draw site on the PR diff.
- `docs/first-party-plugins.md`: github's row notes it is portable except `GITHUB_MIRROR`.

## Doors left open

- No CSS remains in the plugin.
- Every surface declares a layout with documented projections.

## Done when

- All five surfaces render through layouts with no raw `div` or `span` and no CSS.
- The PR pane passes the smoke checklist for review, merge, and comment flows.
- `pnpm lint` and `pnpm test` are green.

## Verify before building

- `plugins/github/src/client/PullDetail.tsx` is about 26 KB and holds the custom detail layout the
  survey saw; `GithubBrowse.tsx` has `pane-left`, `pane-mid`, `pane-right` sections.
- `plugins/github/src/client/PullList.tsx` has its own virtualised list with `RowActions`.
- `plugins/github/src/client/{importer.css}` and `styles/` exist.
- `Shortcuts.tsx` calls `registerKeybindings` from `@acorn/plugin-api/ui/host`.
