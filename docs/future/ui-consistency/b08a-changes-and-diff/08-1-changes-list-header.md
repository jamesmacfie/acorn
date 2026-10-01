# 08-1. The Changes list header hides its own summary and runs under the collapse control

**Status:** not started. Batch B08a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The Changes list header is one `Toolbar` holding six things in a 300-pixel column: "22 uncommitted",
the totals "+2706 −2488", **View options**, **Refresh**, **Stage all**, and **Send 20 notes → agent**.
That needs about 518 pixels. The two text spans give way first and measure 0 wide, so the header never
says how many files changed. **Send** still overflows into the diff column, under the collapse control.
After a send, the result line is a third text span in the same bar, so the person never learns whether
the send worked. The size of the change and the reason review notes exist are both broken at the
default width.

## Where to see it

The task **Review changed files** › **Changes** pane. Add a line note in the diff to make **Send**
appear. Do not press **Send notes to agent**, **Publish**, or **Commit**.

## Already done

- K2 noted that the header's last button still runs under the collapse control. It is this finding.
- K4a made the **View options** menu's choices real radio items.

## The fix

The local fix. A `DiffSource.toolbar` member, which would put **Send** in the diff toolbar beside the
notes it sends, is a plugin-API change and is deferred (see [deferred.md](../deferred.md)).

In `plugins/changes/src/client/ChangesPane.tsx:129-174`:

- The list header is the house list header: `SectionHeader` "Changes" with its count, then **View
  options**, **Refresh**, and **Stage all** or **Unstage all** as ghost sm.
- Drop the "+2706 −2488" totals. Each row already has its counts.
- **Send** and its result line leave the bar. They become an `Alert variant="banner"` at the top of the
  list, "{n} notes not sent", with **Send** in its `actions`. The result line shows in the same banner.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `ChangesPane.tsx:47` | {n} uncommitted / working tree clean | Rewrite | Header label "Changes" with count {n}. Clean: count 0. |
| `ChangesPane.tsx:134` | not a git project | Rewrite | Not a Git project |
| `ChangesPane.tsx:99` | How this list is drawn (View options `title`) | Remove | Use "View options" as the `tip`. |
| `ChangesPane.tsx:143` | Refresh changes (`title`) | Keep | As `tip`. |
| `ChangesPane.tsx:153, 158` | Stage all / Unstage all, tip "Stage every change", sub "git add -A" | Keep | |
| `ChangesPane.tsx:165` | Bracketed-paste the unsent notes into the task's agent (queued until idle) | Rewrite, as `tip` | Sends your unsent notes to this task's agent. If it's busy, they wait until it's free. |
| `ChangesPane.tsx:168` | Send {n} notes → agent ● | Rewrite | Send {n} notes to agent. Drop the idle "●". |
| `changesModel.tsx:409` | No running agent session. | Rewrite | No agent is running for this task. |
| `changesModel.tsx:411` | Send failed. | Rewrite | Couldn't send the notes. |
| `changesModel.tsx:414` | Queued — delivers when the agent is idle. / Sent. | Rewrite | Queued. The agent gets them when it's free. / Sent. |

The plan's overrule: row 640 and the Context rows use one sentence, "No agent is running for this
task."

## What earlier batches give you

- **Chrome-bar buttons are sm** (K1a), so the header's buttons size themselves.
- **The collapse control's room** (K2's 02-5): the first bar in the list column pads its end.

## Risk and checks

- Before you start, measure the header's contents at 1440 wide and confirm it fits after the change.
- This touches the Changes list, which sits beside measured diff code. Do not change row heights.
- Screens: the Changes list with and without unsent notes, scrolled.
- Tests: `plugins/changes` (re-run a stalled file alone; one Changes suite stalls in about half of
  runs).
