# Phase 3: the review path

Date: October 30, 2026. Status: not started. Needs phase 2.

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
