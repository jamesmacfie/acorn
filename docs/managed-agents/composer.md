# The composer

The composer is where you write a turn to a managed session. This page covers the message field,
mentions, the expand chord, and the two slots other plugins fill. The code is in
`plugins/agents/src/client/composer/`.

## The message field

The field is the kit's `MentionTextarea`. It draws `@file`, `/command`, and `$skill` in three role
tones, `accent`, `warn`, and `ok`, which the theme maps like any other tone. A textarea can't color
part of its value, so a `<pre>` mirrors the draft over it and the field's own text is transparent.
Both share every property that places a glyph. Above 20,000 characters, the mirror is dropped and the
field paints itself.

A command or skill is colored only when the session advertises that name, so `9/11` stays prose and a
misspelled `/reviw` stays plain. File mentions come from the same worktree file list that builds the
turn's file parts. An `@` token with no exact match stays plain text and doesn't block sending.

Typing a sigil opens one dropdown: `@` lists worktree files, `/` the session's commands, and `$` its
skills. Rows are `PickerRow`, with the name over the description. The list scrolls past 280px, and the
arrow keys scroll it directly instead of calling `scrollIntoView`, which could scroll the transcript
too. Only `@` waits on a fetch, which starts the first time the field takes focus, because the list
runs to about 145 KB and most visits never type `@`. The `＋` picker inserts the same tokens.

Hovering a colored command or skill shows its description through the `data-tip` tooltip. Those
spans take the pointer and hand the caret back to the textarea on mousedown.

## Expand the field

⌘⇧↩, or the expand button in the box's corner, grows the field from three rows to 18. It's the chord
the shell uses to maximize a pane. It isn't a registered keybinding, because a task-scoped binding
doesn't fire inside a typing target. The terminal client registers `agents.composer.expand` for the
same job. The transcript yields the height and keeps its place. The state is per composer and lasts
the app session, because two panes on one session are two readers.

## Composer slots

The composer has two cooperative extension points
([the four rules](../plugins/cooperative-extension-points.md#five-kinds-four-rules)):

- `agents:attachment` decides how one attachment on an unsent turn is drawn, keyed by media type, in
  `replace` mode. One attachment stays one chip.
  [Draft attachments](./attachments.md#draft-attachments) covers replacing one.
- `agents:composer-actions` is room in the action bar beside **Attach** and the two pickers, in
  `stack` mode with a ceiling of four.

## Drafts and subagent views

The composer's draft is held per session outside the component, as are its attachments and captured
context ([reads and drafts](./client-surfaces.md#reads-and-drafts)). So stepping into a subagent's run
and back keeps typed text, and the Workflows run pane can draw a second composer on the same session.
The queue shows each waiting turn's text and attachment tiles, and an attachment-only turn shows the
tiles alone.

## Draft and operation ownership

`composerState.ts` owns one mutable draft for each Node and session. It holds text, attachment IDs,
context, hydration, and the send, upload, replacement, and capture guards. A rendered composer holds
that draft while it is visible and reads it again when navigation changes the session or Node.
Presentation choices, including field height, context dismissal, and the open picker, stay in
`AgentComposer.tsx`.

`submitOperation.ts` assembles the captured text, file mentions, attachments, context, policy, and
source before it enqueues a turn. The shared draft acknowledges the submitted revisions after the
request succeeds, so edits made during the request remain. `attachmentOperations.ts` handles picker,
paste, drop, removal, and replacement. It keeps successful uploads if another file fails, limits a
turn to eight attachments and 25 MiB, and persists a replacement before deleting the old row.
`contextOperations.ts` handles manual capture and the single-flight automatic task capture. Each
operation receives the originating draft, session, and Node before its first await; completion uses
that origin rather than whichever session the composer displays later. Automatic capture rejects a
result after a Node switch. The composer closes a context picker only while it still shows the
originating draft.
