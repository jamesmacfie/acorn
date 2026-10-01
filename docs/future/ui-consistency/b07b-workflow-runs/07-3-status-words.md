# 07-3. Run surfaces print the machine's status and kind words

**Status:** not started. Batch B07b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Step status shows as the enum: `waiting-gate`, `pending`, `failed`, and in code `safety-rail` and
`completed-with-failures`. The run footer says `gated` or `failed` in lower case. The rail's recent-run
meta is `waiting`, or the whole error sentence. A command step's kind reads `terminal:command` where
the editor says **Run a command**. The rail's run glyphs have no tone, so a failed run is grey there
and red in the run pane. "waiting-gate" is not a word a person uses, and status is the one thing these
lists are scanned for.

## Where to see it

The run pane on **Plan follow-up work** (rows, step header, graph cards, footer), and **Recent runs** in
the Workflows rail.

## The fix

- `plugins/workflows/src/client/runs/runDisplay.ts`: add `stepStatusLabel` and `runStatusLabel` beside
  the glyph and tone maps. Words: **Waiting**, **Needs you**, **Done**, **Failed**, **Stopped at a
  limit**, **Finished with failures**, **Cancelled**, **Not started**, **Skipped**. Model them on
  `plugins/workflows/src/client/runs/recordHistoryModel.ts:11-23`.
- Use them at `RunPane.tsx:120, 135, 188`, `RunGraph.tsx:28`, and `NodeDetail.tsx:167`.
- `NodeDetail.tsx:306, 447`: "Approved.", "Rejected.", "Cancelled." in place of "This gate is
  {status}."
- `plugins/workflows/src/client/WorkflowsBrowse.tsx:40, 293-295`: `runGlyph`, `runTone`, and the label,
  in place of the local `STATUS_GLYPH`.
- `kindLabel` takes the step catalog where the run pane can reach it. Where it cannot, keep the id and
  note it.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `RunPane.tsx:135` | {status} (raw) | Rewrite | The status label. |
| `NodeDetail.tsx:306, 447` | Approved. / This gate is {status}. | Rewrite | Approved. / Rejected. / Cancelled. |

The run footer's words are [07-13](./07-13-run-pane-controls.md)'s; the rail row's meta is
[07-12](./07-12-rail-list.md)'s. Both use these labels.

## Risk and checks

- Before you start, list every run and step status the protocol defines, so each has a word.
- Run status also shows in Settings › Run history and in Agent Center. They are not in this batch, but
  they should read the same map later.
- Screens: the run pane (gate waiting, failed, graph), and the rail with a waiting and a failed run.
- Tests: `plugins/workflows`.
