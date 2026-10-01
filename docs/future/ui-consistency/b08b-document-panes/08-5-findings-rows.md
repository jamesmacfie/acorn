# 08-5. Findings rows wrap one word per line, and every row has the same title

**Status:** not started. Batch B08b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Each Findings row shows the full timestamp as meta, "Sep 30, 2026 at 11:07 PM", which takes 178 of the
row's 300 pixels. Every automatic finding is titled "Managed agent turn completed", cut to "Managed
ag…", so all 19 fixture rows start the same way. The list is hard to read and every entry looks
identical, so the only way to find anything is to open each one.

## Where to see it

The task **Review changed files** › **Findings** pane (a remote tree). The fixture has 19 observations.

## Already done

- K1a capped row meta at half the row and gave the body a floor, so the excerpt no longer wraps one
  word per line. The kit half of this finding is done.

## The fix

In `plugins/findings/src/tree/FindingsPane.tsx:280-290`:

- Meta shows a short time ("11:07 PM"), with the full date through `tipAt`.
- The title is derived on the client (plan decision 13), so old records benefit too: the body's first
  sentence, else "Agent turn {n}" or "Workflow step {name}". The server titles stay as they are.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `plugins/findings/src/node/index.ts:79`, `server/lifecycle.ts:246` | Managed agent turn completed / Workflow-managed turn checkpoint | Rewrite on the client | The turn's first sentence, else "Agent turn {n}" / "Workflow step {name}". The stored title does not change. |

## Risk and checks

- Before you start, check `plugins/findings/src/tree/findingPresentation.test.ts`, which asserts the
  stored title; a client-derived title should not break it.
- Findings is a loaded plugin. Rebuild its bundle to see the change.
- Screens: the Findings list with 19 rows.
- Tests: `plugins/findings`.
