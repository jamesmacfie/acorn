# 08-24. Smaller defects in the document panes

**Status:** not started. Batch B08b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Four small defects left in the document panes. Item c, marking the file in view in the Changes list
while the diff scrolls, is a new feature and is deferred (see [deferred.md](../deferred.md)).

## Where to see it

Notes (group headers), Context (an absent section), and Findings (a finding's facts and its section
heading).

## Already done

- a. **Stage all** becomes ghost sm in 08-1 (shipped in B08a);
  the Notes **Show in Context** link in [08-12](./08-12-notes.md).
- e. K4b moved the commit dialog's hint into the body and fixed its footer.
- f. The Findings list header is [08-7](./08-7-one-pane-frame.md).

## The fix

- **b.** Notes' group headers are 40 high, because each holds a 26 icon button; Changes' are 32. In
  `packages/client-core/src/infra/styles/primitives.css`:
  `.section-header[data-level='group'] .ui-btn[data-icon-only] { min-height: var(--control-h-xs) }`
  (and the matching width), so the two panes' group headers match.
- **d.** `plugins/context/src/client/ContextPane.tsx:126`: the text "⚠" becomes an `Icon` or an
  inline warn `Alert`.
- **g.** `plugins/findings/src/tree/FindingsPane.tsx:122`: drop the "Source key
  agent:be3c476a-…:1:280" fact, or put it behind a copy button.
- **h.** Say "Findings" everywhere, including `FindingsPane.tsx:149, 271`, where the pane says
  "Observations".

## Copy

| Item | Where | Current text | Decision | New text |
| --- | --- | --- | --- | --- |
| d | `ContextPane.tsx:126` | ⚠ {detail} | Rewrite | An inline warn `Alert` with {detail} |
| g | `FindingsPane.tsx:122` | Source key {key} | Remove | |
| h | `FindingsPane.tsx:271` | Observations | Rewrite | Findings |

## Risk and checks

- Before you start, confirm the Notes group header's icon button is the only thing setting its height.
- Item b reaches every group header with an icon button. Check the agent session list and Archive.
- Screens: Notes with several groups, Context, and a finding's detail.
- Tests: client-core, `plugins/context`, `plugins/findings`.
