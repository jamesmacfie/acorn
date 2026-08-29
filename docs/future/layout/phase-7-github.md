# Phase 7: github

Status: shipped 2026-08-30.

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

## What shipped, and where it differs

Eleven deviations from the plan above. Each was a decision made while building, and each is recorded
here rather than in the owning doc, because the owning doc says what is true and this says what
changed.

**1. The pull strip lives in the panels, not beside the tab bar.** A task can be about several pull
requests, and the strip that switches between them used to sit above the whole pane. The `tabs`
layout's bar is the host's and has no room in it, so the strip opens every panel instead, drawn from
one per-task model (`pullDetail/prTabs.ts`). On the Files tab it sits at the top of the navigator
column rather than over the split, because a scroller between the layout and the two columns it sizes
would take their height away. It is a `ChipRow` rather than a tab strip: a chip carries its kind icon
and the button that opens the linked task or the creating agent, which a tab does not have a slot for.

**2. Conversation is not `header-body-footer` with a pinned composer.** The plan asked for the
composer as a footer region. That would mean nesting a layout inside a tab panel, which means two
region-focus registrations for one pane, and the composer is above the timeline today. It stayed
there. Nothing about the tree makes pinning it hard later; there was just no reason to pay for it in
the same change that moved everything else.

**3. The file list is flat.** The plan listed a `TreeRow` navigator as an accepted difference, so it
wanted a directory tree. A tree is a change in what the navigator says rather than a move to the kit,
this list is the file order the finder and `[` and `]` cycling already agree on, and nothing asked for
it. It is a `Rows` collection of `Row`s, virtualised on the Files tab and flat inside the browse
navigator's fold.

**4. `Rows` learned to virtualise, and the collection learned to reach a row it cannot see.** The
plan said the pull list should be "virtualised by the kit's collection host rather than the plugin's
own scroller", and no such thing existed. `Rows virtual` is it: the scroller, the row placement and
the density number are the kit's, and the body is called for the rows in view with each one's
placement. Roving focus still walks the whole list, because `createCollection` gained `scrollToKey` —
when the row it wants to focus has no element, it asks the scroller to reach it and focuses on the
next frame. github's list lost a virtualizer, a scroll element, two animation frames and a pair of
hand-registered `j` and `k` bindings.

**5. `j` and `k` are the collection's now, not a global chord.** They used to move the pull selection
from anywhere in the app through a `typing-exempt` binding. They are intents on the focused
collection, so they move whichever list has focus, and they do nothing when nothing does. That is
what phase 2 was for, and it is a real behaviour change on this pane.

**6. Two host components came out of the move.** `ProviderHtml` draws HTML a provider already
rendered, in the host's markdown skin, with the bare-reference pass and the link handling; it replaced
three hand-written `.ui-markdown` bindings in github and is why `docs/security.md`'s `bodyHTML` list
went from four entries to two. It is not a kit node, because the reference pass is a registry function
and `ui/` may not import one. `RefPanelBox` is the backdrop, drawer, title and dismiss affordance a
reference panel is drawn in, which every first-party panel used to redraw. A loaded plugin's panel
keeps its own copy in `PluginRefPanel.tsx`: an iframe takes the drawer's height directly rather than
sitting in the scrolling body, which is a different arrangement rather than the same one with a flag.

**7. `ListDetail` gained a third column genre and a scrolling column.** browse is two splits, one
inside the other, and its middle column is a pull request rather than a picker. `listWidth="wide"`
(`--listdetail-w-wide`, the width the old middle pane had) and `ListColumn scroll` are what that
needed: a column that scrolls as one region and takes the pane's inline padding, the same rule
`single` and `header-body-footer` apply to their bodies. `.layout-tabs-panel` got the same treatment,
for the same reason `.layout-hbf-body` did in phase 6.

**8. `selectPaneTab` is the door between panels.** "View in diff" in the conversation has to show the
Files tab. The selection is the host's, held under the pane id, so the pane asks rather than keeping a
second copy. It is exported from `@acorn/plugin-api/ui/host` and it is the only way in.

**9. The checks drawer is a modal.** The plan did not mention it. It was a hand-drawn right-hand
drawer with its own stylesheet; it is a `Modal` of `Fold`s over the kit's `Log`, portalled because the
pane that opens it sets `contain: layout paint`. Accepted difference: the step logs lost their ANSI
colour, because a log is text and the kit draws text in one place.

**10. The compare preview is a `DiffPane`.** The plan asked for it and it was worth saying twice: the
preview used to hydrate and lay out its own rows, because the shared viewer was not something a second
surface could drive. It is now, given a source with nothing to write to, and eighty lines of parse
bookkeeping went with the move.

**11. The importer is not a wizard, and the navigator kept no scroll memory.** The importer is one
screen, and the one place it appears in a wizard is first-run onboarding, where it is already a step
inside onboarding's own. Wrapping it would nest one wizard in another. Separately,
`reviewScrollRestoration.ts` and `reviewViewState.ts` are deleted rather than reduced: the navigator
is a region of a host layout now, and there is no `.pane-mid` for the controller to bind. The diff
column's own position and collapsed files are unaffected, in `diff/viewState.ts` where they always
were.

## Owed after this phase

- The tests the plan asked for in the jsdom tier are host tests instead. A plugin package runs
  `.test.ts` in bare Node with no Solid transform, so github cannot render a component in its own
  suite; `Rows virtual` is covered in `client-core/src/keys/keys.test.tsx`, the annotation mechanism
  by phase 6's `changes:diff-line` tests, and github's own suite holds the two point declarations.
  Rendering the PR pane through each tab needs a jsdom project in the plugin, which is phase 9's
  question, not this one's.
- The smoke checklist in `docs/testing.md` covers review, merge and comment by hand. Nothing here
  ran it.
- `_resetCollectionState` does not clear the store: `setStates(() => ({}))` merges rather than
  replaces, so a suite inherits the previous test's place. The new test works around it with a
  distinct collection id. One line to fix, and nothing in this phase depended on it.
