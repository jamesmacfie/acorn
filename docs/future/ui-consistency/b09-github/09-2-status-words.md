# 09-2. GitHub status is machine words, drawn five different ways

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

One pull request's state, its checks, and its reviews each have their own treatment, in GitHub's enum
words. Checks read "SUCCESS", "FAILURE", "IN_PROGRESS". All checks together are a split red and amber
dot with no word. Review states are coloured muted text, lower case. A thread in the diff reads
"CONVERSATION" or "RESOLVED" in the label treatment. "Is it green, and has anyone asked for changes" is
what a person opens a pull request to learn, and the page answers three ways.

## Where to see it

GitHub with the area 09 seed: the pull list, #42's overview and sections, the conversation, the diff's
threads, and the reference panel (from code).

## Already done

- K3 added `StatusDot tip` and routes an `Icon`'s `title` to the styled tip.

## The fix

- `packages/client-core/src/kit/lib/rendering/displayMeta.ts:53-92`: `checkStatusWord` (Passed, Failed,
  Cancelled, Timed out, Skipped, Neutral, Running, Queued, Waiting, Needs action) and `checksSummary`
  ("All checks passed", "1 check failing", "2 checks running").
- `plugins/github/src/client/pullDetail/PrOverview.tsx:43-57`: the pull state as a toned `Badge` (Open,
  Draft, Merged, Closed).
- `PrOverview.tsx:106-112`: merge method names **Squash and merge**, **Create a merge commit**, **Rebase
  and merge**.
- `prSections.tsx:114-148, 211-217`, `PullList.tsx:268-285` (the dot's tip through `StatusDot tip`; the
  state icon toned, its title through the styled tip), `PullRefPanel.tsx:66-94`, and
  `Conversation.tsx:74-91, 188` (review state badges, "Resolved").
- `packages/client-core/src/kit/diff/DiffRows.tsx:520`: "Unresolved" or "Resolved" in sentence case.
  `diff.css:250-257` drops the label treatment. The font size stays, so the thread's height does too.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `PullList.tsx:269, 279` | Checks: {success, failure, pending, mixed} | Rewrite | The `checksSummary` words: All checks passed, 1 check failing, 2 checks running. |
| `PullList.tsx:281` | open / draft / closed (native title) | Rewrite | Draft, Closed, as the styled tip. |
| `PrOverview.tsx:56` | open / draft / closed / merged | Rewrite | Open, Draft, Closed, Merged |
| `PrOverview.tsx:111` | squash / merge / rebase | Rewrite | Squash and merge / Create a merge commit / Rebase and merge |
| `prSections.tsx:133` | SUCCESS, FAILURE, IN_PROGRESS, … | Rewrite | Passed, Failed, Running, Skipped, Waiting, Queued, Cancelled, Timed out, Neutral, Needs action |
| `prSections.tsx:140` | Rerun / Queued | Rewrite | Re-run / Re-run queued |
| `Conversation.tsx:188` | resolved | Rewrite | Resolved |
| `DiffRows.tsx:520` | Conversation / Resolved | Rewrite | Unresolved / Resolved, in sentence case |
| `DiffRows.tsx:522` | Unresolve / Resolve | Keep "Unresolve" | The plan's overrule: "Reopen" is the pull request's own button. |
| `DiffRows.tsx:525` | Show / Hide | Keep | |
| `PullRefPanel.tsx:71` | {state} lower case, Draft capitalised | Rewrite | Open, Draft, Closed, Merged |
| `PullRefPanel.tsx:89` | {n} check(s) | Rewrite | The `checksSummary` words |
| `model.ts:11-18` | approved / requested changes / reviewed / dismissed review | Keep | The byline verbs read as a sentence. |

The plan's overrules: row 567's summary words ("All checks passed") win over the area finding's shorter
ones ("All passed"), and row 609's list gains Neutral and Needs action.

## What earlier batches give you

- **`StatusDot tip`** (K3's P15). Opt-in, not taken from `label`.
- **`Badge tip`** (K3's P14), if a review badge names its reviewers.

## Risk and checks

- Before you start, list every check status GitHub's API returns, and give each a word.
- The `DiffRows` change is text only. Check a thread's height stays the same.
- The new helpers live in the kit's display helpers, beside `checkStatusTone`. They are not exported to
  plugins unless a plugin needs them; GitHub is compiled.
- Screens: the pull list, #42's overview and checks, the conversation, and a diff thread.
- Tests: `plugins/github`, client-core (`displayMeta` and the diff tests).
