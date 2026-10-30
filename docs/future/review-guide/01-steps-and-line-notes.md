# Phase 1: steps and line notes in the answer

Date: October 30, 2026. Status: not started. Needs nothing.

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
