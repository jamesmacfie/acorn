# Phase 1: steps and line notes in the answer

Date: October 30, 2026. Status: done. Needs nothing.

## Completion note

Landed October 30, 2026.

### What landed

- The answer has `steps`, each with `goal` and `notes`. `GUIDE_SCHEMA`, `GuideAnswer`, the stored
  `Guide`, the pane, and the workflow step's description all say steps.
- `checkNotes` in `plugins/review-guide/src/server/notes.ts` runs right after `checkCoverage` in
  `runTurn`. `misplacedNotes` sits on `Guide`, and the pane shows a line for it.
- `src/shared/hunk.ts` holds the one row parser, `hunkRows`, beside `hunkStart`, which moved there
  from the pane. The Node's note check and the pane both import it.
- A stored guide with `sections` reads as steps with an empty goal and no notes, through `readGuide` in
  `guides.ts`. A route test inserts one and reads it.
- The pane shows each goal as "After this step you'll know …", and draws notes under their hunk as a
  plain list: a tone badge, the title, `Line N` or `Deleted line N`, and the body as Markdown.
- The plugin doc, the site's review guide page, and the plugin's sentence in
  `apps/site/src/data/plugins.ts` describe steps and notes.

### Decisions

- `text` must match the whole line, after trimming trailing whitespace on both sides. The measurement
  below gave no reason to accept fragments.
- No ceiling on the step count. Guides came back with 3 to 11 steps for 3 to 31 hunks, so the
  prompt is enough for now.
- The old side holds deleted rows only. A note on an unchanged row must say `new`, as the field
  table says. A note that says `old` on an unchanged row is dropped.
- The schema sets no `maxLength` or `maxItems`. A breach would fail the whole answer, so the note
  check enforces the caps instead.
- `checkCoverage` passes each step's other fields through untouched, and counts the notes of a step it
  drops in `misplacedNotes`. `checkNotes` adds its own drops to that count, so the pane's one line
  covers both checks.
- Notes past a cap count as dropped, so the pane's line says "didn't match a line of the change or
  went past the limit".

### Deviations

- The first measurement showed that both harnesses repeat "After this step you'll know" in `goal`.
  The prompt now asks for only the finishing words, and `checkCoverage` strips the opening words if
  they still come back. That way every reader of a goal gets the fragment, phase 3 included.
- The live check ran Claude Code (`claude -p --json-schema`) and Codex (`codex exec --output-schema`)
  headless and read-only, with `guideTurn`'s exact prompt and `GUIDE_SCHEMA`, and then ran both checks
  on each answer. It didn't run in `pnpm dev:agent`, because that needs a task with a real pull request
  attached. The pane's drawing is covered by `GuidePane.test.tsx`, not by a screenshot.

### Measurement

There were six runs on three real changes: `6be0a88cd` (7 hunks), `07e3ba770` (3 hunks), and this
phase's own plugin diff (31 hunks).

| Change | Harness | Steps | Notes | Kept | Moved | Dropped |
| --- | --- | --- | --- | --- | --- | --- |
| `6be0a88cd` | Claude Code | 5 | 8 | 8 | 0 | 0 |
| `6be0a88cd` | Codex | 5 | 2 | 2 | 0 | 0 |
| `07e3ba770` | Claude Code | 3 | 3 | 3 | 0 | 0 |
| `07e3ba770` | Codex | 3 | 1 | 1 | 0 | 0 |
| This phase | Claude Code | 10 | 8 | 8 | 0 | 0 |
| This phase | Codex | 11 | 2 | 2 | 0 | 0 |

Every hunk was covered once in every run. Claude Code leaves about four times as many notes as Codex.
Most of them are **Look closely**, and they read as real review points rather than narration.

### For later phases

- A note's `line` is always a real row on its side after the check, so phase 2 can place a note by
  `hunk`, `side`, and `line` alone. Use `hunkRows` to find the row, rather than a second parser.
- A step's `goal` is a fragment with no opening words, and it's empty on an older guide. Hide the goal
  line when it's empty.
- `Guide.steps[].notes` is in reading order, so phase 3's wrap-up can list them in that order.
- Notes don't carry an ID. Phases 3 to 5 need a stable key for progress or for marks. The mockup builds
  one from `hunk`, `side`, and `line`, but the check allows two notes on one row, so add the note's
  position on its row when the key must be unique.

## Goal

The harness answers with a path of steps, each with a goal, and with short notes pinned to lines. The
Node checks every note against the diff before it stores the guide, so a note never lands on a line it
doesn't describe. The current pane draws the notes as a plain list under each hunk, so this phase is
usable on its own.

## Starting point

Checked against `main` at `e94c01050`. Recheck before you start.

- `GUIDE_SCHEMA` and `guideTurn` in `plugins/review-guide/src/server/prompt.ts` ask for a summary and
  sections. Each section has a title, a "why", a kind (`core` or `supporting`), and hunk IDs.
- `checkCoverage` in `plugins/review-guide/src/server/coverage.ts` holds the answer to the diff: every
  hunk once, unknown IDs dropped, and missing hunks in `uncovered`.
- `Guide` in `plugins/review-guide/src/shared/guide.ts` is the stored shape, kept as JSON in the
  `guide` column of `review_guides`.
- A `DiffItem` is one hunk with its ID (`path#n`) and its patch text. The hunk's `@@` header gives its
  old and new start lines.
- The workflow step's output is the summary, then one `- ` line per section title
  (`plugins/review-guide/src/server/workflowStep.ts`).

## In scope

### The answer

Rename sections to steps in the schema, the stored type, and the pane. Each step gains two fields:

| Field | What it holds |
| --- | --- |
| `goal` | One sentence that finishes "After this step you'll know", such as "which answers are retried and which are final." |
| `notes` | Notes on lines of this step's hunks, in reading order. |

A note holds:

| Field | What it holds |
| --- | --- |
| `hunk` | The ID of a hunk in the same step. |
| `side` | `new` for an added or unchanged line, `old` for a deleted one. |
| `line` | The line number on that side. |
| `text` | The line's exact text, without its `+`, `-`, or space marker. This is the anchor. The number is a hint. |
| `tone` | `explain`, `attention`, or `risk`. The pane labels them **Explains**, **Look closely**, and **Risk**. |
| `title` | One sentence, at most 120 characters. |
| `body` | Markdown, at most 600 characters. |

### The prompt

Rewrite the instructions in `guideTurn`:

- Order the steps as a journey through the change. Start where the data or the request enters, and let
  each step build on the one before it. Core steps come first, and supporting steps such as tests,
  docs, and wiring come after.
- Give each step a goal the reviewer can check themselves against.
- Leave a note only where a careful reviewer would stop: a line whose purpose isn't obvious, a
  decision worth questioning, or a likely bug. Don't narrate what a line says. Most hunks need no
  note.
- Quote the line's text exactly in `text`.

### The note check

Add a note check beside `checkCoverage`, in the same file or its own, and run it in the same place.
For each note, in order:

1. Drop it if `hunk` isn't one of its step's hunks after the coverage check.
2. Parse the hunk's rows with their old and new numbers. If the row at `side` and `line` has the quoted
   `text`, keep the note.
3. Otherwise, look for the quoted text on that side in the same hunk. If exactly one row matches, move
   the note there. Compare after trimming trailing whitespace.
4. Otherwise, drop it.
5. Drop notes past three on one hunk, or past 40 in the guide, in reading order. Cut a title or a body
   over its limit at the last word that fits.

Count what was dropped in a `misplacedNotes` field on `Guide`, beside `repeated` and `unknown`, and
show a line for it in the pane as the coverage notes do. Reuse the row parser the pane's `hunkStart`
already starts on, and keep one parser for the Node and the tree. The shared folder is the place for
it.

Notes on a hunk that lands in **Not covered by the guide** are dropped with it, because that hunk has
no step.

### Storage and older guides

The stored JSON changes shape, and the table doesn't. A stored guide written before this phase has
`sections` and no notes. Read it as steps with an empty goal and no notes, rather than failing or
dropping it, because each guide cost harness usage. No migration is needed.

### The pane

Rename **section** to **step** in the pane's text. Under each hunk, draw its notes as a plain list:
the tone, the title, the line it's on, and the body as Markdown. Phase 2 moves them onto their rows.
Show each step's goal under its title.

### The workflow step

Keep its output shape: the summary, then one `- ` line per step title. Update the output's
description to say steps.

## Decide before you build

- Whether `text` must match the whole line or may be a fragment of it. A whole line is stricter and
  simpler. A fragment survives the harness trimming a long line. Start with the whole line, and count
  how many notes the check moves or drops on real changes.
- Whether the step count needs a ceiling. A path of 15 steps is a pile again. A prompt instruction may
  be enough. Measure it before adding a check.

## Tests

- The note check: a note on its quoted line is kept, a misnumbered note moves to its unique match, an
  ambiguous or missing quote drops it, a note naming a hunk from another step drops it, and the caps
  hold. Use the fixture in `plugins/review-guide/src/server/__fixtures__/change.diff`.
- The coverage tests still pass with steps.
- An older stored guide with `sections` reads as steps.
- `routes.test.ts`: a generated guide answers with steps and notes.
- `GuidePane.test.tsx`: notes draw under their hunk, and the dropped-note line shows.
- `pnpm --filter @acorn/plugin-review-guide test` and `pnpm typecheck`.
- A live run in `pnpm dev:agent` with Claude Code and Codex on a real pull request. Record how many
  notes the check kept, moved, and dropped.

## Docs

Update [the review guide plugin](../../first-party-plugins/review-guide.md): the answer, the note check
beside the coverage check, and the pane.

## Done when

Generating a guide on a real pull request gives steps with goals, and notes that each sit on the line
they quote. A note the harness misplaced is moved or dropped, and the pane says how many were dropped.
