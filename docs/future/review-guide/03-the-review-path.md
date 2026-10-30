# Phase 3: the review path

Date: October 30, 2026. Status: done. Needs phase 2.

## Completion note

Landed October 30, 2026.

### What landed

- `src/shared/path.ts` builds the path from a guide with `guidePath`: each step's minutes (one per 40
  changed lines, at least one), its added and removed lines, and a key for each note. The hunks the
  guide left out are a last step, **Not covered by the guide**, with no kind. The tree draws from it,
  and the progress route checks a mark against it.
- `review_guides.progress` is a nullable JSON column, `0001_clever_boom_boom.sql`. It holds
  `GuideProgress`: `pages` (`overview`, `step-<n>`) and `notes` (note keys).
  `POST /v1/p/review-guide/guide/progress` takes `{ taskId, page?, note?, done }` with exactly one of
  `page` or `note`. It writes in one synchronous transaction, so two marks sent together can't
  overwrite each other, then sends `plugin:review-guide:changed` and answers the view. An unknown page
  or note is a 400, and a task with no guide is a 409.
- The tree mounts twice: `pane` draws `GuidePane` wide and `panel` draws it narrow. The three
  `review-panel` extensions point at `panel`. `GuidePane.tsx` keeps the shell (loading, toolbar,
  states) and `GuidePath.tsx` holds the rail, the stepper, the three pages, and the hunks and notes.
- The wide layout is a `ListDetail` with the rail as its list. The narrow one is the progress line, a
  row of numbered `xs` buttons, then the page. Beside the diff, a hunk with notes draws through
  `StackedDiff noteContext={0}`, a hunk with none is its link alone, and opening a step calls
  `revealChangeRequestLine` with its first hunk.
- Two additive kit changes, on both hosts. `StackedDiff` takes `noteContext`, the code rows kept on
  each side of a noted row, with hunk headers dropped (`keptRows` in `kit/diff/diffNotes.ts`).
  `DiffNote` takes `open` and `onOpenChange` in `Fold`'s controlled mode, so the guide's **Got it** can
  fold a note.
- Docs: the plugin page's storage and routes sections, and the pane moved to its own page,
  `docs/first-party-plugins/review-guide/pane.md`, because the plugin page passed 200 lines.
  `every-node.md` rows for `StackedDiff` and `DiffNote`, and the site's `StackedDiff`, `DiffNote`, and
  review guide pages.

### Decisions

- No keys. A loaded plugin's keybinding must include a modifier and can run only a host action verb,
  and none of those reaches a tree, so `j`, `k`, and `n` can't work. The pane doc says so.
- **Leave your review** is a sentence pointing at **Details**, not a button. The tree has no verb to
  select that tab.
- The guide opens on the first page that isn't done, so closing and reopening, or switching between
  the pane and the column, keeps the reader's place. Each surface keeps its own open page after that.
- The wrap-up has no stored state. It counts as done once every step is reviewed and every Look
  closely and Risk note is checked. With that, the progress line counts the overview, the steps, and
  the wrap-up, as "2 of 5 done" does.
- A note's key is `hunk:side:line`, with `:2` appended for a second note on the same row, as phase 1's
  note asked.
- **Got it** folds an Explains note for this view only. It isn't progress.
- **Mark checked** doesn't fold a note. It turns into **✓ Checked** and toggles back.
- The 256 KiB rule stays for one huge step: within a page, hunks past 256 KiB of text wait behind a
  closed `Fold` that draws them when opened. Pages no longer need it otherwise.
- Lists over the guide use `Index`, not `For`, so a progress mark, which replaces the view object,
  doesn't redraw every hunk or reset a note's fold.

### Deviations

- `DiffNote` gained `open` and `onOpenChange`. The phase doc didn't name a kit change, but **Got it**
  can't fold a note without one, because phase 2 kept the fold inside the kit.
- The rail's "~5 min" is the whole guide's minutes, not the minutes left.
- Live check, desktop: done in `pnpm dev:agent` on the `site-snapshots` fixture, with the site's fake
  GitHub, a hand-added change request link, and a guide seeded through the plugin's own parser and
  checks (project memory `walk-review-guide-live-in-dev-agent`). The narrow column, the wide rail,
  marking steps, checking a note in the wrap-up, and progress showing in the other surface all worked.
  The check found two drawing faults, now fixed: `Text` on pages truncated instead of wrapping, and
  a note's button row overflowed the narrow column. The second fix was built but not looked at again.
- Live check, terminal: not done. In `pnpm dev:tui:agent` the guide built into the data root and its
  trust prompt was accepted, but the Node never started the plugin after two restarts. The terminal
  drawing of `noteContext` is covered by `kit.test.tsx`.
- Staging for `pnpm dev:agent` fails on the mobile startup budget on this branch: styles are
  129,053 B of 128,000 B. This phase adds no CSS, so the growth came earlier, likely phase 2's note
  card. The check ran with `--prepared` around it.
- The site's component pages all cite `every-node.md`, so the stale check lists them. Only the
  `StackedDiff` and `DiffNote` rows changed, and only those two pages and the review guide page were
  updated and marked.

### For later phases

- Phase 4 replaces **Ask a follow-up**'s handler in `Note` (`GuidePath.tsx`). It reveals the line for
  now, the same as **Show in diff**.
- Phase 5 can use `guidePath` for each note's step number and key.
- The terminal client's live check is still owed for phases 2 and 3.

## Goal

The guide reads as a path: an overview, one page per step, and a wrap-up. The reader marks each step
reviewed and moves on, and the guide remembers how far they got. The Guide pane gets a wide layout
with a rail, and the column beside the diff gets a compact stepper.

## Starting point

Checked against `main` at `e94c01050`. Recheck before you start.

- `GuidePane` in `plugins/review-guide/src/tree/GuidePane.tsx` draws the summary, then every section as
  a `Fold` with its hunks. It opens folds on first draw only until their hunk text reaches 256 KiB,
  because the host refuses a tree batch over 1 MiB.
- One tree entry, `pane`, fills both the **Guide** task pane and each code host's `review-panel` point
  (`plugins/review-guide/acorn-plugin.config.mjs`, `src/tree/index.tsx`).
- In a window, the `review-panel` tab's column sits beside the diff. In a narrow terminal it's a tab
  before **Diff** (`packages/change-request-ui/src/views/ChangeRequestView.tsx`).
- Trees can draw `ListDetail`, `ListColumn`, and `DetailColumn`, which have a terminal projection
  ([pane layouts](../../panes/layout.md#layout-model)).
- Remote trees get no key events. `KIT_EVENTS` holds none, by design.

## In scope

### Two layouts from one tree

Mount the tree twice in `src/tree/index.tsx`: `pane` draws the wide layout, and `panel` draws the
narrow one. Point the three `review-panel` extensions at `panel`. Keep the shared parts, such as
loading, the toolbar, and the states, in one place.

The wide layout, in the Guide pane, is the mockup's **Guide** tab:

- A rail on the left: **Review path**, a progress line such as "2 of 5 done · ~5 min" with a `Meter`,
  then the overview, each step, and the wrap-up as rows. A step's row shows its number or a check, its
  title, its kind, its hunk count, its minutes, and one dot per note in its tone.
- The page on the right: the step that's open.

The narrow layout, in the column beside the diff, is the mockup's **Guide beside diff** tab:

- A stepper on top: the progress line, then the overview, each step, and the wrap-up as numbered
  buttons.
- The page below, showing only the lines that carry notes, because the full diff is in the next column.
  Add a `noteContext` prop to `StackedDiff` for this: the number of rows kept around each note, with
  `0` for the noted rows alone. Drop hunk headers between kept runs.
- Opening a step shows its first hunk in the diff beside it through
  `bridge.ui.revealChangeRequestLine`. The wide layout doesn't do this, because there it would switch
  panes.

### The pages

- **Overview.** The summary, the counts (steps, hunks, files, lines added and removed, minutes, and
  notes by tone), "By the end you'll know" listing each step's goal, a card per step, and the coverage
  line. One button: **Start the path**.
- **A step.** "Step 2 of 3", its kind, and its minutes. Then the title, the goal, the why, and the
  hunks with their notes. At the foot: the next step's title, **Back**, and **Mark reviewed &
  continue**.
- **Wrap up.** Every Look closely and Risk note as a `Checkbox` row: its title, its path and line, the
  step it's in as a link, and its tone. A count of what's still open. The guide doesn't approve or post
  anything. It tells the reader to leave their review in **Details**.

Each note's buttons, from phase 2, are **Ask a follow-up**, **Show in diff**, and **Mark checked** for
Look closely and Risk, or **Got it** for Explains, which folds it. **Ask a follow-up** reveals the line
until phase 4 makes it open the agent card.

Only the open page draws its hunks, so a large guide stays under the batch limit without the 256 KiB
rule. Remove that rule once a page can't exceed it, or keep it for a single huge step.

### Minutes

Work out a step's minutes in code, not in the answer: one minute per 40 changed lines, at least one.
It's a rough guide and the rail says "~". Tune the rate after a few real guides.

### Progress

Add a nullable `progress` column to `review_guides`, generated with drizzle-kit into
`plugins/review-guide/migrations`. It holds JSON: the pages marked done, and the note IDs marked checked.
A note's ID is its hunk ID, side, and line, such as `src/billing/invoice.ts#2:new:42`.

Add `POST /v1/p/review-guide/guide/progress`, taking `{ taskId, page?, note?, done }`, held to the
caller's task like the other routes. It answers the view and sends `plugin:review-guide:changed`, so a
second surface showing the same guide follows. Progress lives on the guide's row, so regenerating
starts it fresh, and a stale guide keeps its progress until it's regenerated.

The pane and the column read the same progress, so a step marked in one shows as done in the other.

## Decide before you build

- Keyboard moves. The mockup uses `j` and `k` for steps and `n` for the next note. A tree can't hear
  keys, so this needs plugin commands bound to keys while the guide has focus. Check whether a loaded
  plugin's command can do that today. If it can't, ship without keys and note it in the docs.
- Whether **Leave your review** in the wrap-up should be a button. The tree has no verb to select the
  **Details** tab, so a button needs one. A sentence is enough to start.
- Which page opens first: the overview every time, or the first step not done.

## Tests

- `GuidePane.test.tsx`, or one test file per layout: the overview's counts and goals, moving through
  steps, **Mark reviewed & continue** saving progress, the wrap-up listing only Look closely and Risk
  notes, and checking one there marking the same note on its step.
- The narrow layout draws only noted lines and reveals a step's first hunk when it opens.
- `routes.test.ts`: the progress route stores and answers, refuses another task's caller, and a
  regenerated guide starts with no progress.
- `StackedDiff` with `noteContext`, on both hosts.
- The migration applies on a Node with existing guides.
- A live check in `pnpm dev:agent`: the Guide pane's rail, the column beside the diff, and progress
  moving between them. Then the terminal client in `pnpm dev:tui:agent`, at 80 by 24.

## Docs

Rewrite the pane section of [the review guide plugin](../../first-party-plugins/review-guide.md#the-pane)
for both layouts, and add the progress column and route to its storage and routes sections.

## Done when

A reviewer opens the guide, starts the path, marks each step reviewed, and ends on a wrap-up that lists
what's left to decide. Closing and reopening the pane, or switching between the pane and the column
beside the diff, keeps their place.
