# Phase 4: ask from the guide

Date: October 30, 2026. Status: not started. Needs phase 2.

## Goal

**Ask a follow-up** on a note, or ✦ on any line of the guide, opens the inline agent card on that line
in the pull request diff. The note's text goes with it as context. The conversation is the ordinary
inline diff chat, so it stays on that line in the **Diff** tab afterwards.

## Starting point

Checked against `main` at `e94c01050`. Recheck before you start.

- `bridge.ui.revealChangeRequestLine(path, line?, side?)` shows a line in the task's change request
  diff. The broker checks the place in `packages/client-core/src/host/frames/broker.ts` and needs the
  `core.changeRequests:reveal` scope, which the guide has
  ([showing a line in the change request](../../plugins/frames.md#showing-a-line-in-the-change-request)).
- The place travels as a `change-request:reveal` pane intent. Each code host takes it with
  `onChangeRequestReveal` and calls `requestFileScroll`, which `DiffPane` consumes to scroll to the
  line. GitHub's is in `plugins/github/src/client/pullDetail/PrPane.tsx`. `DiffPlace` is
  `{ path, line?, side? }` in `packages/client-core/src/host/registries/commands/clientEvents.ts`.
- `DiffPane` passes `source().inlineChat?.open` to each row as `askAgent`, the ✦ button.
  `ChangeRequestDiff` in `packages/change-request-ui/src/views/ChangeRequestDiff.tsx` implements
  `open` by setting `openInline`, and draws `InlineDiffCard` under the row with
  `loadContext={() => loadDiffLineContext(diffSource, row)}`.
- In the terminal client, revealing a line opens it in the editor, because the diff column beside the
  tabs isn't a keyboard stop.

## In scope

### Ask as part of a place

Add an optional `ask` to `DiffPlace` and to the bridge call, as
`revealChangeRequestLine(path, line, side, { ask: { note } })`. `note` is optional text for the agent,
at most 2,048 characters. The broker refuses an `ask` without a line, or a note over the limit, with
`bad_request`. No new scope: asking opens a card the reader still has to send from.

### The diff opens the card

When `DiffPane` consumes a held place with `ask`, it scrolls to the line as today. Once the segment
holding that row loads, it calls `inlineChat.open(row, { note })`. Add the second argument to
`inlineChat.open` in the diff source type as optional, so other callers don't change. A place whose
line no segment covers lands on the file's header and opens nothing, as a reveal does.

`ChangeRequestDiff` keeps the note with the opened origin. Its `loadContext` puts the note first, under
a line that says it came from the review guide, then the line context it loads today. The card itself
doesn't change. The agent sees the note, and the reader sees their own question.

GitLab and Bitbucket take the same place through `onChangeRequestReveal`, so check that each passes
`ask` through to `requestFileScroll` unchanged.

### The guide

- **Ask a follow-up** on a note calls the bridge with the note's title and body as `note`.
- ✦ on a line, the `onActivate` event from phase 2, calls it with no note.
- In the wide Guide pane, this switches to the change request pane, which is where the card lives. In
  the column beside the diff, the diff next to it scrolls and opens the card.

### The terminal client

Revealing opens the editor, so `ask` has nothing to open there. The terminal ignores it and opens the
line in the editor, as it does for any reveal. The guide doesn't need to know which host it's in.

## Decide before you build

- Whether a note that already has a conversation should show that in the guide, such as "1 reply". The
  guide can't read agent sessions, so that would need a capability from the agents plugin. Leave it
  out unless the walk shows readers losing track.
- Whether the note goes in the prompt as context or into the card's draft text. Context keeps the
  reader's question short and matches the line context. The draft would let the reader edit it.

## Tests

- The broker: `ask` without a line, or a note over 2,048 characters, is `bad_request`. A good one
  reaches the frame service with `ask` intact.
- `DiffPane`: a held place with `ask` opens the inline chat on that row once its segment loads. A place
  without `ask` doesn't. A line outside every segment opens nothing.
- `ChangeRequestDiff`: the opened card's context starts with the note.
- The guide: **Ask a follow-up** sends the note, and ✦ sends none.
- A live check in `pnpm dev:agent` on GitHub: ask from a note in the column beside the diff, send a
  question, and find the same conversation on that line in the **Diff** tab. Repeat from the wide Guide
  pane. Check GitLab or Bitbucket with a fixture if no account is at hand.

## Docs

Update [showing a line in the change request](../../plugins/frames.md#showing-a-line-in-the-change-request)
for `ask`, [shared review views](../../plugins/change-request-ui.md) for the note in the card's
context, and the pane section of [the review guide plugin](../../first-party-plugins/review-guide.md#the-pane).

## Done when

Pressing **Ask a follow-up** on a note, or ✦ on a guide line, opens the agent card on that line of the
pull request diff with the note as context. The conversation shows on that line afterwards.
