# 09-9. A conversation thread's file link wraps and centres on two lines

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

In a pull request's conversation, a thread's link to its file is a ghost sm button whose label,
"src/client/rail/RailBadge.tsx L14 — view in diff", wraps and centres on two lines in the 332-pixel
column. It reads as a heading, not a link.

## Where to see it

GitHub with the area 09 seed › #42 › **Conversation** section, at a review thread.

## The fix

The partial fix. One composer for comments and reviews is a different model from GitHub's and a
product call; a reply box that starts as one line, and **Resolve** and **Hide** at a real size, change
measured diff thread heights. All three are deferred (see [deferred.md](../deferred.md)).

- `plugins/github/src/client/pullDetail/Conversation.tsx:183-215`: the file link is one `Link`,
  "RailBadge.tsx, line 14", with the full path as its tip.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `Conversation.tsx:195` | {path} L{n} — view in diff | Rewrite | {file name}, line {n} (a link; the full path in its tip) |
| `Conversation.tsx:25` | Shown when you scroll to it. | Keep | |
| `Conversation.tsx:199` | Snippet unavailable. | Keep | |
| `Conversation.tsx:223` | No content. | Keep | |
| `Conversation.tsx:298` | No comments or commits. | Keep | |
| `Conversation.tsx:343` | ⌘↵ to send | Keep | B02 already writes it through `formatChord`. |
| `DiffRows.tsx:539` | Reply unavailable / Reply… | Rewrite | Can't reply to this thread / Reply… |

Held with the one-composer decision: `Conversation.tsx:268, 276` (one placeholder, "Comment, or write
your review…") and `:281, 287, 291` (button order).

## Risk and checks

- Before you start, confirm the thread card is not measured in a virtual list; the conversation uses
  near-viewport bodies.
- Screens: #42's conversation with review threads.
- Tests: `plugins/github` (`Conversation.test.tsx`).
