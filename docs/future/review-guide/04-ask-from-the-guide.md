# Phase 4: ask from the guide

Date: October 30, 2026. Status: done. Needs phase 2.

## Completion note

Landed October 30, 2026.

### What landed

- `DiffPlace`, the `revealChangeRequestLine` wire request, both bridge signatures, and the plugin
  authoring tool's description take an optional `ask: { note? }`. The SDK call is
  `revealChangeRequestLine(path, line, side, { ask: { note } })`. `MAX_ASK_NOTE_CHARS` (2,048) sits in
  `@acorn/protocol/plugin/bridge.ts` beside the other bridge limits.
- The broker refuses an `ask` without a line, an `ask` that isn't an object, or a note that isn't text
  or is over the limit, with `bad_request`. It rebuilds `ask` with only `note`, so nothing else from the
  frame reaches the host. There's no new scope, but asking follows `openTask`'s rule: only from a
  click or key handler, at most once a second, or it's `denied`. A plain reveal needs neither.
- `inlineChat.open` takes an optional second argument. `DiffPane` calls it with the held place's `ask`
  right after `revealMatch`, and only when the line was found in its segment.
- `ChangeRequestDiff` keeps the note with the opened origin. Its `loadContext` puts the note first,
  under "The reader asked from a plugin's note on this line. The plugin wrote it, not the reader:",
  then the line context it loaded before.
- GitHub, GitLab, and Bitbucket spread the place into `requestFileScroll`, so `ask` passes through
  them unchanged. The terminal client's `revealChangeRequestLine` reads only the path and line, so it
  ignores `ask`.
- The guide: **Ask a follow-up** sends the note's title and body as `note`, and ✦ sends `ask: {}`.
  **Show in diff** and the hunk links don't ask.
- Docs: a new "Asking about the line" section in `docs/plugins/frames.md`, a sentence in
  `docs/plugins/change-request-ui.md`, the pane doc's buttons paragraph, the plugin page's scope line,
  and the site's review guide page, which is marked.

### Decisions

- The note goes into the prompt as context, not into the card's draft. It keeps the reader's question
  short, matches how the line context already works, and needed no change to the agents plugin's card.
- The label in the context doesn't name the review guide. `ChangeRequestDiff` is shared, and any plugin
  with the reveal scope can send a note. It says a plugin wrote the note, so the agent doesn't take it
  as the reader's words.
- A security review after the first commit pointed out that the note reaches the agent unseen. So
  asking needs the reader's own click or key press in the plugin, and shares `openTask`'s
  once-a-second budget. That stops background code from slipping text into the reader's next
  question. The reader still doesn't see the note in the card. Showing it there is a change to the
  agents plugin's card, which this phase kept out, and is listed under **For later phases**.
- No "1 reply" in the guide. The live check didn't show a reader losing track, because the
  conversation sits on the line in the diff next to the guide.
- ✦ on a guide line asks with no note, rather than plainly revealing, so it opens the card in one press
  the same way the diff's own ✦ does.

### Deviations

- The phase doc asked for a context line that says the note came from the review guide. It says a
  plugin wrote it instead, for the reason under **Decisions**.
- The phase doc said asking needs nothing beyond the reveal scope. It also needs the reader's act, for
  the reason under **Decisions**.
- GitLab and Bitbucket were checked by reading the code, not with a fixture. Both take the place
  through the same `onChangeRequestReveal` and spread it into `requestFileScroll`, which is what
  `DiffPane` reads.
- The terminal client wasn't run, because it ignores `ask` by construction and the earlier phases'
  terminal walk is still owed.

### Live check

Run in `pnpm dev:agent` on the `site-snapshots` fixture, with the recipe in project memory
`walk-review-guide-live-in-dev-agent` and a seeded guide with one Risk note on `vat.py:19`.

- From the column beside the diff, **Ask a follow-up** scrolled the diff to `vat.py:19` and opened the
  card. The sent turn's prompt began with the note's title and body under the label, then the code
  around the line, then the question. After a reload, the conversation was still on line 19 in the
  diff. The fixture's harness is a stand-in, so the session shows "failed", but the turn and its
  prompt were stored.
- From the wide Guide pane, ✦ on `tests/test_vat.py:10` switched to the pull request pane and opened
  the card on line 10. Its prompt had no note.
- From the wide pane, the diff lands short of the asked line, so the card opens below the screen. A plain hunk link from the wide pane lands at the same offset, so this comes from revealing
  into a pane that has just been switched to, while the existing card and review thread on
  `vat.py:19` above it are still unmeasured. It isn't from `ask`. From the column beside the diff, the
  line lands on screen.
- After the gate went in: a real click on **Ask a follow-up** in the wide pane passed it, switched to
  the pull request pane, and opened the card on `vat.py:19`. A script's click with nothing focused
  was refused, and the guide showed the refusal.
- The mobile startup budget still fails at 129,053 B of styles. This phase adds no CSS. Staging was
  done by hand and the session ran with `--prepared`.

### For later phases

- A note becomes a line conversation through `ask`, so the open question about posting a note to the
  code host as a review comment can be decided now.
- Show the note in the card, labelled with the plugin that sent it, so the reader sees what goes to
  the agent. That's the agents plugin's `InlineDiffCard`, and `Card` would take the note as a prop.
- The landing offset above needs a fix in `DiffPane`'s reveal, not in the guide: the reveal should
  hold the line in place while the blocks above it are measured, the way scroll restoration does.

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
