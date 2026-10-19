# The composer

The composer is where you write a turn to a managed session. This page covers the message field,
mentions, the expand chord, and the two slots other plugins fill. The code is in
`plugins/agents/src/client/composer/`.

## The message field

The field is the kit's `MentionTextarea`. It draws `@file`, `/command`, and `$skill` in three role
tones, `accent`, `warn`, and `ok`, which the theme maps like any other tone. A `#` context reference
keeps the text color and takes a dotted underline. A textarea can't color
part of its value, so a `<pre>` mirrors the draft over it and the field's own text is transparent.
Both share every property that places a glyph. Above 20,000 characters, the mirror is dropped and the
field paints itself.

A command or skill is colored only when the session advertises that name, so `9/11` stays prose and a
misspelled `/reviw` stays plain. File mentions come from the same worktree file list that builds the
turn's file parts. An `@` token with no exact match stays plain text and doesn't block sending.

Typing a sigil opens one dropdown: `@` lists worktree files, `/` the session's commands, `$` its
skills, and `#` Acorn's context sources ([below](#reference-acorn-context)). Both lists are what the harness reported at its last start or resume, so a plugin skill appears
only once the harness loaded it natively: `/acorn-<pluginId>:<id>` in Claude Code and
`$acorn-<pluginId>:<id>` in Codex ([native delivery](./native-skills.md)). Rows are `PickerRow`, with the name over the description. The list scrolls past 280px, and the
arrow keys scroll it directly instead of calling `scrollIntoView`, which could scroll the transcript
too. Only `@` waits on a fetch, which starts the first time the field takes focus, because the list
runs to about 145 KB and most visits never type `@`. The `＋` picker inserts the same tokens.

Hovering a colored command or skill shows its description through the `data-tip` tooltip. Those
spans take the pointer and hand the caret back to the textarea on mousedown.

## Expand the field

⌘⇧↩ on macOS, Ctrl+Shift+Enter elsewhere, or the expand button in the box's corner toggles the field
between three rows and 18. The textarea handles the keymap's `maximize` intent while focused, before
the shell's pane-maximize binding. Outside the field, the chord maximizes the pane. The terminal also
registers `agents.composer.expand` on Alt+E for terminals that can't distinguish modified Enter.
The transcript yields the height and keeps its place. The owning Node's preferences remember the
expanded or collapsed choice per session, through the task-scoped `agents.composer-expansion` slice.
Returning to a session or relaunching restores its field height. Two panes showing the same session
share the choice. Sessions without a saved choice start collapsed.

## Composer slots

The composer has two cooperative extension points
([the four rules](../plugins/cooperative-extension-points.md#five-kinds-four-rules)):

- `agents:attachment` decides how one attachment on an unsent turn is drawn, keyed by media type, in
  `replace` mode. One attachment stays one chip.
  [Draft attachments](./attachments.md#draft-attachments) covers replacing one.
- `agents:composer-actions` is room in the action bar beside **Attach** and the two pickers, in
  `stack` mode with a ceiling of four.

## Steer

While a Claude Code or Codex turn runs, **Steer** sits beside **Send**. It queues the draft and hands
it to the running turn, which reads it after its current step. Enter still queues.
[Steer a running turn](./steering.md) covers the queue's **Steer now** and what the Node does.

## Session goal

The **Goal** button below an interactive session's message field opens the completion-condition
editor. When a goal is set, the row above the composer shows its goal, status, last check reason,
and continuation count. **Edit** opens the editor, **Clear** removes the goal, and a paused goal offers
**Resume**. The same controls appear in the desktop and terminal clients. The
palette's **Set session goal** command opens the editor for the visible session. A goal is separate
from the message draft and survives leaving the session.

## Reference Acorn context

Type `#` to reference Acorn context in the message itself, such as "compare this with
#agent:refactor-login". The list shows each source's keyword and name. Choose one, or type its
keyword and a colon, and the list shows that source's items. Choose an item to write its token and a
space. A token is `#keyword:slug`, where the slug is the item's label in lowercase with each run of
other characters turned into one hyphen.

| Token | What it attaches |
| --- | --- |
| `#agent:<session>` | Another top-level session in this task, as below. Subagent and workflow-step sessions aren't listed. |
| `#terminal:<session>` | A terminal session's last 200 lines of output as plain text, with secret-shaped values redacted on the Node. |
| `#docker:<container>` | A task container's image, state, and ports. No environment values and no logs. |
| `#task` | The sections selected in the Context pane, the same snapshot the first turn gets. |
| `#http:<request>`, `#db:<query>` | A saved API request or database query, with credentials redacted. |

A loaded plugin's source has its own keyword ([descriptors](../plugins/descriptors.md)).

The token in the text is the selection. Delete it and the context goes with it. A `#` counts only at
the start of a word and followed by a known keyword, so `#123`, `# Heading`, and `C#` stay prose, and
the list closes on the first character that matches no keyword. A token that resolves is underlined,
and an underlined token is exactly what the turn attaches. A hand-typed token resolves when one item
in its source has that slug. Completion records which item it meant with the draft, so two sessions
with the same title stay apart, and the second one's token gets `-2`.

**Context** in the action bar opens the same two steps as a list. Choose a source, then tick its
items. A tick writes the item's token at the caret and an untick removes it. Escape steps back from
the items to the sources, and **Done** closes the list and returns to the field.

The composer captures each referenced item when you press **Send**, so the content is current. Each
source is asked once, with a 10-second limit, and an item named twice is sent once. If a source fails
or leaves an item out, the send stops, the draft stays, and the error names the token. The total
still has to fit in 512 KiB. Each snapshot reaches the harness as an `<acorn-context>` block whose
`ref` attribute is the token, so the agent can tell which block the text means.

You can't see a reference's size before sending, because nothing is captured until then. Terminal
redaction matches common token shapes, not every secret, and nothing shows you the output first. Don't
reference a terminal that printed a secret you need to keep.

In the transcript, a sent token is a link. Pressing it opens what it named: the session for an
agent thread, and the pane for anything else.

### Another session's snapshot

The Node reads up to the last 200 conversation events, plans, and file changes, with a
100,000-character text cap. A truncation marker identifies omitted earlier events. Tool output is
excluded. The agent receives the conversation inside a pasted-content block, labeled as reference
material. The device-only reference route checks the source session's task before reading it.

## Drafts and subagent views

The composer's draft is held per session outside the component, as are its attachments and captured
context ([reads and drafts](./client-surfaces.md#reads-and-drafts)). So stepping into a subagent's run
and back keeps typed text, and the Workflows run pane can draw a second composer on the same session.
The queue shows each waiting turn's text and attachment tiles, and an attachment-only turn shows the
tiles alone.

## Draft and operation ownership

`composerState.ts` owns one mutable draft for each Node and session. It holds text, attachment IDs,
context, the map from each completed `#` token to its item, hydration, and the send, upload,
replacement, and capture guards. A rendered composer holds
that draft while it is visible and reads it again when navigation changes the session or Node.
`composerPrefs.ts` owns the saved field height per session and removes it when a session is deleted
or its task is evicted. Automatic-context dismissal stays in `AgentComposer.tsx`. `contextReferences.ts`
is the pure parser and resolver for `#` tokens, with no Solid and no fetches, so the browser extension
can share it. `contextCatalog.ts` reads each source's items on demand for one composer.

`submitOperation.ts` assembles the captured text, file mentions, attachments, context, policy, and
source before it enqueues a turn. The shared draft acknowledges the submitted revisions after the
request succeeds, so edits made during the request remain. `attachmentOperations.ts` handles picker,
paste, drop, removal, and replacement. It keeps successful uploads if another file fails, limits a
turn to eight attachments and 25 MiB, and persists a replacement before deleting the old row.
`contextOperations.ts` handles capture at send for `#` references and the single-flight automatic
task capture. Each
operation receives the originating draft, session, and Node before its first await; completion uses
that origin rather than whichever session the composer displays later. Automatic capture rejects a
result after a Node switch.
