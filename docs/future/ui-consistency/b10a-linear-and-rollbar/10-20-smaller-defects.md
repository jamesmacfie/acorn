# 10-20. Smaller Linear and Rollbar defects

**Status:** not started. Batch B10a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Eight small defects. Each is local and small.

## Where to see it

Linear issue ACO-42 (activity, sub-issues, cycle and due dates, attachments, comments), Rollbar item
#1042 (facts), the rail lists' unavailable banner, and the rail tips.

## The fix

- **a.** `plugins/linear/src/tree/LinearIssueView.tsx:23, 70`: typed glyphs ("✦ ○ ◐ ▣ ✎", "✓ ○")
  become eager `Icon` names. "○" today means both "assigned" and "not done".
- **b.** `plugins/linear/src/tree/model.ts:28-29`: short month-day dates ("Oct 7").
- **c.** `LinearIssueView.tsx:191-197`: attachment meta is "GitHub" or nothing; **Copy link** is an
  `IconButton` with a tip.
- **d.** `LinearIssueView.tsx:97, 113, 132`: **Reply** and **← back** at a real size (ghost sm).
- **e.** `plugins/rollbar/src/tree/RollbarItemView.tsx:83-88`: mono only for versions and hosts.
- **f.** "Not reported" and "No one", in place of "unknown" and "unassigned".
- **g.** `packages/client-core/src/host/chrome/ChromeSourcePanel.tsx:270`: the unavailable banner loses
  its em dash and sits in the inset. Rewording it to name the source rather than the node is part of
  10-3, which is deferred.
- **h.** Manifest labels "Linear issues" (`plugins/linear/acorn-plugin.config.mjs:101`) and "Rollbar
  errors" (`plugins/rollbar/acorn-plugin.config.mjs:66`), which also read better as the rail tip.

## Copy

| Item | Where | Current text | Decision | New text |
| --- | --- | --- | --- | --- |
| b | `LinearIssueView.tsx:60` | {n} pts | Rewrite | {n} points |
| b | `LinearIssueView.tsx:61` | C14 → 10/7/2026 | Rewrite | Ends Oct 7 (the plan's overrule: do not repeat the label) |
| b | `LinearIssueView.tsx:62` | 10/6/2026 | Rewrite | Oct 6 |
| c | `LinearIssueView.tsx:191` | github (attachment source type) | Rewrite | GitHub, or nothing |
| c | `LinearIssueView.tsx:196` | Copy link (on an attachment) | Keep | As an icon button with this tip. |
| | `LinearIssueView.tsx:178` | Copy the branch name (native title) | Keep | K3 already draws it as the styled tip. |
| | `LinearIssueView.tsx:58-64, 188, 209` | Assignee / Opened by / Team / Project / Links / Relations | Keep | |
| f | `RollbarItemView.tsx:86`, `model.ts:14` | unknown | Rewrite | Not reported |
| f | `RollbarItemView.tsx:87` | unassigned | Rewrite | No one |
| g | `ChromeSourcePanel.tsx:270` | {node} unavailable — {reason} | Rewrite the punctuation | Drop the em dash: "{node} is unavailable. {reason}". The full rewrite waits with 10-3. |
| h | `linear/acorn-plugin.config.mjs:101` | Linear (source label) | Rewrite | Linear issues |
| h | `linear/acorn-plugin.config.mjs:163` | active issues in the Linear projects this repository follows | Rewrite | open issues in the linked Linear projects |
| h | `rollbar/acorn-plugin.config.mjs:66` | Rollbar (source label) | Rewrite | Rollbar errors |
| h | `rollbar/acorn-plugin.config.mjs:48` | Rollbar item (surface label) | Rewrite | Rollbar error |
| h | `rollbar/acorn-plugin.config.mjs:99` | active items in the projects this repository follows | Rewrite | active errors in the linked Rollbar projects |

The two palette hints (`:163` and `:99`) stay lower case, which is the palette's hint convention (the
plan's overrule on rows 603 and 647).

## What earlier batches give you

- **The eager icon set** (K1a's P1 and K4a): check each new `Icon` name is in
  `packages/client-core/src/kit/tokens/iconNodes.eager.json`, and run the icon census if not.

## Risk and checks

- Before you start, check which of the typed glyphs already have Lucide equivalents.
- The manifest labels need the bundles rebuilt and the node restarted. Search docs for "Linear" as a
  source label; B02 updated some docs for the palette titles.
- Screens: ACO-42's activity, sub-issues, links, and comments; #1042's facts; the rail tips.
- Tests: `plugins/linear`, `plugins/rollbar`, and the client-core icon census.
