# Managed agent client surfaces

Part of [managed-agents.md](../managed-agents.md).

## Client surfaces

The Agent pane is a `list-detail` layout (docs/panes.md § Layout model). The list column is the task's
roster, with a header region of its own so the count stays put while the list scrolls; the detail
column is the open session. The roster is managed sessions, delegated children, and provider-native
subagents, and nothing else: it used to
carry a third group merging this task's terminals with a run's workflow steps, and both halves have a
better home — the terminal drawer, and the Workflows pane. Nothing in the plugin lays anything out and nothing in it ships a
stylesheet: every surface here is a tree of kit nodes, so the same source draws in the shell today and
through the remote root when a harness plugin is loaded rather than compiled
(docs/ui-design.md § The closed kit).

The detail column has a header, a transcript and a composer without a second set of regions. The
transcript is a `Timeline` with `follow` set, which means the kit owns the scroll: it stays on the
newest turn until the reader scrolls away from it, picks the bottom up again when they scroll back,
and gives a reader the place they left when they come back to a session. The bar above it and the
composer below it are pinned by being that scroller's siblings.

Immediately after the title, the header hosts the `agents:session-header` remote `stack` point. Its
props are a public projection rather than the ledger itself: task and session ids, provider id,
per-turn usage and resolved prices, and explicit token/cost accounting modes. The owner stops there.
The bundled `agent-cost` loaded plugin prices and formats those facts, preferring provider-reported USD
and otherwise showing an API-equivalent estimate; disabling that plugin removes the badge without
changing Agents. The point is not cost-specific, so independently installed plugins can fill the same
seat with a token counter or budget warning. The complete contract lives in
[cooperative extension points](../plugins/cooperative-extension-points.md#remote-trees).

That is a property of the region, not of this pane, which is why the conversation reaches its region as
a fragment and never wraps itself in a box: the region is the flex column the scroller sizes against,
and the CSS that caps the measure and hands the padding over names the scroller as a direct child of
it (`packages/client-core/src/infra/styles/shell.css`). Any surface drawing the conversation owes it
the same treatment, so a test asserts it rather than a comment asking for it
(`plugins/agents/src/client/sessions/AgentConversation.test.tsx`). Which surface is drawing also keys
the remembered scroll place, because a reader can be following live in one pane and reading history in
another.

The timeline is not virtualised, and that is the kit's rule rather than this pane's. The virtualizer
this transcript used to run called `measure()` on every new event, which clears the item size cache,
so every row fell back to the estimate, the canvas height jumped, and the rows re-measured, on every
event. It also rebuilt its rows from `getVirtualItems()`, which hands back fresh objects on each
scroll, replacing the DOM under any text selection. If a session ever feels slow to open, render the
last N behind a "show earlier" control: a fixed window has no measurement feedback loop. Two more
guardrails hold in the same place. A card seeds its fold state at mount and then leaves it alone, so
a call finishing does not slam its card shut, and the sidebar's rows are keyed by session id rather
than by object identity, so the roster rebuilding on every socket frame does not replace the row
somebody is reading.

**A selection survives a streaming update**, and a test says so rather than a habit. A message
re-renders only the block that is still growing, so the paragraphs above it keep their elements and
their text nodes, and a reader who selected across two of them still has that selection when the next
delta lands. `packages/client-core/src/kit/components/content/Markdown.test.tsx` holds it against the
real `Selection`: it selects across two blocks, streams an update into a third, and asserts the
selection reads back the same text. Written that way rather than as an element-identity check because
it fails for any reason a selection can break, not only for the one it was written after.

- Agent Center aggregates sessions, search, provider health, attention, transcript import, and launch.
  Its archived filter offers **Restore** on a session someone archived on its own. A session retired
  because its task was archived has no such button: it comes back when the task is restored, because
  retirement is worked out when the list is read (docs/workspaces-and-tasks.md § Restoring a task).
- On an archived task, which only the archive page's preview shows, the Agent pane is read-only: the
  transcripts draw, the composer is off, and there is no new-session picker.
- A provider draws as its own mark wherever it is named: the onboarding cards, the New picker, each
  block in Settings -> Agent defaults, and the session icon in Agent Center. The name comes off the
  descriptor's `glyph`, so a contributed harness gets the same treatment by pointing that field at a
  mark it registers. The two built-in ones are `brand:agents/claude` and `brand:agents/codex`, drawn
  by `ProviderGlyph.tsx` and coloured from the mark (docs/ui-design.md section Brand colour). The
  colour is mixed toward the theme's foreground rather than used raw, because a brand hex is authored
  against white and OpenAI's purple is unreadable on a dark pane.
- The Agent pane shows the current transcript, composer, queue, context, requests, artifacts, and a
  same-task roster. The first three of those are one component, `AgentConversation`, addressed by a
  session id, and the Workflows run pane draws the same one through the `agents.conversation` client
  capability. So a session can be on screen twice, and everything two composers have to agree about —
  the attachments and captured context of an unsent turn, and the guards over sending it — lives in a
  module map keyed by session (`plugins/agents/src/client/composer/composerState.ts`) rather than in
  the component. What stays per mount is view state: how tall the box is, which picker is open, and
  which surface's scroll place the transcript restores.
- A roster row puts the provider's live reasoning effort beside its live model name. Codex reports
  those as separate configuration options, and both can change while the session is open, so the
  display reads `configOptions` rather than the legacy model column. Provider-native subagents inherit
  the same combined summary when the provider has not named a different child model. Dashboard data
  keeps model as its own typed field; the combined value is presentation text, not a stored contract.
- Starting an interactive session acknowledges the durable row before waiting for the provider CLI.
  The pane selects that row immediately, draws a **Connecting…** state above the composer, and keeps
  the draft editable while Send and provider configuration remain disabled. `ready` is published only
  after the provider handshake, session metadata, and saved new-session defaults have all settled, so
  the first turn cannot race the model or reasoning settings it is meant to use. Workflow creation
  keeps its ready-on-return contract because its caller has no draft UI to occupy the wait.
- A tool call is one card, no matter how many updates a provider sends for it. The event ledger still
  stores a row per update, which is what replay and any later timing question read; the transcript
  folds those rows by turn and tool id, so a command shows one panel whose status and output change in
  place. A call's parameters and output sit behind a disclosure toggle, and a call with nothing to show
  for either renders as a flat row instead, so no card opens onto nothing. A provider reports a status
  only when it changes, so an update carrying nothing but output leaves the last reported status alone.
- Whether that toggle starts open is the reader's setting, **Tool call display** in Settings -> Agent
  defaults: start collapsed, start expanded, or carry the reader's last toggle forward. It is a device
  preference (`agent_tool_fold`), so it sits on that page beside settings the node keeps. The default is
  collapsed, which means a running command's output no longer scrolls into view unattended.
  `AgentToolCallCard` resolves the setting once and passes `defaultOpen` and `onOpenChange` to whichever
  renderer draws the call, so a contributed renderer honours the setting and trains the carry-forward
  mode without reading the preference itself.
- On the desktop, a closed disclosure defers its contents until first opened. Opening a task's
  Agent pane therefore does not render hidden tool output or the nested transcript of a completed
  subagent. Once opened, those contents stay mounted across toggles so their local state survives.
- **The card body is a slot.** Three things can draw it, in order: a compiled plugin's renderer that
  matched the call, then a loaded plugin's remote tree that declared the call's tool name, then the
  built-in card. A compiled renderer wins because it draws in the transcript's own realm and costs
  nothing; a remote one runs in that plugin's worker and emits a tree of the host's own components,
  which the transcript grafts in place of the card body
  (`docs/plugins.md` section The client half of a loaded plugin). Either way the props are the same
  `tool`, `defaultOpen` and `onOpenChange`, and a card that fails to draw shows a labelled placeholder
  without disturbing the transcript around it. This is what stopped the tool card from being the reason
  a plugin had to be first-party: `changes` is still compiled, but nothing about the card requires it.
- A card seeds that state at mount and then leaves it alone. Read reactively it would shut the card the
  moment its call finished, which is when somebody is most likely to be reading it.
- The setting, and not the call's reported status, is what decides this. Status was what used to make
  the answer differ by harness with nothing in the product saying so: Codex reports a started call as
  `running`, while the ACP path reports `pending` and then `completed` and never `running` at all, so
  one provider's cards opened themselves and the other's never did. For the same reason the ACP path
  maps a call's `rawInput` into the card as pretty-printed JSON. Output only lands on the completion
  update there, since Acorn declines ACP's terminal capability, so without the parameters a running
  Claude call had nothing to disclose and could not honour the setting until it was over.
- **Claude's plan-mode handover is the exception to that.** `ExitPlanMode` carries the whole plan as
  one markdown string in its parameters, so pretty-printed JSON draws it with every line break spelled
  out as `\n`, and that plan is the one thing in a planning session somebody wants to read. The
  normalizer posts it as an assistant message instead, which renders through the transcript Markdown
  policy and survives the chats-only toggle, and the call keeps its title and its outcome with no
  parameters to disclose. Only the opening `tool_call` is read that way: the parameters arrive with the
  call, so reading an update as well would post the plan twice.
- A plan update is a complete snapshot. Every snapshot remains in the durable ledger, while the
  transcript folds snapshots from one turn into the card the first one opened; a new turn starts a new
  card. Each step has one structured status marker and renders its text through the transcript Markdown
  policy, in a status-and-text grid that keeps wrapped lines inside the card.
- Usage folds the same way, one line per turn. A turn's last usage update can arrive after the turn is
  marked complete and so carries no turn id; it updates the line it belongs to rather than starting
  another. That is how a cost joins a line that started with only a context count. **The fold happens
  on the Node now, not per client.** A harness reports usage as a running snapshot, so a turn draws
  about 58 rows, a quarter of everything this ledger holds, and every one of them used to cross the
  wire and sit in every client's event list for the life of the session. The HTTP snapshot route folds
  them before it serialises and the transcript store folds an arriving one onto the line it belongs to,
  both by the rule in `plugins/agents/src/shared/usageFold.ts`, which is the transcript's own rule
  moved somewhere two callers can share it. The surviving row keeps the first update's id and sequence,
  so the line lands where it always landed. The client's own fold in `conversationItems.ts` stays and
  is now defensive: a replayed page, an imported transcript or an older node still folds the way it
  always did.
- **Tool calls fold on the Node too, for a reader that asks.** A call arrives as a run of updates on
  one id, and `tool` is about half of all rows, most of a long session. When the client sends
  `fold=1`, the snapshot route and the event pages behind it fold each call's updates within the page
  onto the record that opened it, by the rule in `plugins/agents/src/shared/toolFold.ts`, which
  `conversationItems.ts` imports too. The surviving record keeps the opener's id, sequence and
  subagent attribution, and it carries `foldedThroughSeq`, the last row it absorbed. A call that spans
  two pages arrives as two records. The second is marked as a continuation unless a row in its page
  replaced the output, which Codex does when a command completes. `foldedThroughSeq` is what makes the
  fold safe to overlap with other reads. Paging resumes from it instead of from the last record's own
  sequence. The transcript also skips any update at or below the card's reach, which covers a socket
  frame a refetch has since folded in. Without that skip, Codex output, which streams as appends,
  would draw twice. A reader that omits the flag, which includes every client older than it, gets
  every row, because it would do both of those things wrong. The client does not fold a live tool
  update when it arrives, so the rows a session streamed while open stay raw in that client's memory
  until it drops the session. The transcript still draws them correctly, it just walks more rows.
- **A folded usage line has no card of its own.** It used to draw at the head of each turn as tokens,
  context and a provider cost on one row. The cost belongs to whichever plugin fills
  `agents:session-header` and already sits beside the session title, and the token counts said the
  same thing twice for a reader scrolling the thread. So the fold feeds the line that closes the turn
  instead: `Turn complete` and its stop reason on the left, the share of the model's context window
  the turn had used on the right. `stampTurnContext` in `conversationItems.ts` copies the figure onto
  the `turn_completed` card by position rather than by turn id, because Codex clears the current turn
  before it emits the completion and the event arrives unattributed. A turn whose harness reported no
  context window closes with its reason alone. Codex's token notification carries cumulative `total`
  counters and one model call's `last` counters: the cumulative input/output values feed session cost,
  while `last.totalTokens` alone is compared with `modelContextWindow`. Treating the lifetime total as
  context makes a long thread appear to exceed its window even though Codex has compacted it normally.
- Anything the agent is blocked on is drawn in the transcript at the point it asked, and that one card
  has two states. While it is blocking, it is the control that answers it: a dropdown, a column of
  checkboxes for a question that takes several answers, a free-text box, or a row of buttons for a
  permission. The reader answers where they are already reading, and the thread keeps the interruption
  in the order it happened. Once it is answered the same seat holds the record: what was asked, what
  was said, and, folded beneath, the options they passed over, which nothing else records.
- What happens after the answer differs by kind. A question stays. A permission goes, because it is a
  decision about one tool call, that call already has a card of its own, and a busy session would bury
  itself under them. Both draw from the request row rather than from their own event, because whether
  anybody has answered yet and what they said both live on the row and keep changing long after the
  event is written. An answer to a question the harness marked secret reads as "Answer hidden", since
  the thread is durable and searchable in a way a prompt answered and gone was not.
- **Chats only keeps the requests.** The toggle above the composer drops the tool calls, the reasoning
  and the notes, and a question the agent asked with the answer sitting on it is the same conversation
  as a message. During planning it is most of the conversation, so leaving it out gave a reader a
  transcript where the agent settled a question it had never asked. An answered permission is already
  gone by then, dropped by the rule in the bullet above rather than by a second one here, so what
  survives the toggle is the questions and whatever is still blocking.
- The task sidebar keeps its own "Needs you" list, which is the way to reach a blocked session the
  reader is not looking at. Picking a row opens that session and brings its card into view.
- A subagent shows up twice: as one card in its parent's transcript, holding everything that subagent
  did, and as one indented row under its session in the task Agent sidebar. The card is seeded expanded
  while the subagent is working and collapsed if it had already settled when the card was first drawn,
  then stays where the reader puts it. Reactive expansion would instead slam the card shut the moment
  the subagent finished, which is when somebody is most likely to be reading it.
- A subagent's run renders through exactly the same cards as its parent's: tool calls, prose, reasoning
  and file changes all go through one `AgentEventCard`, so a contributed tool card works inside a
  subagent's run without knowing it is in one. A tool call belongs to whichever stream opened it, and
  every later update folds there wherever it arrives from, because a provider need not repeat the
  attribution on each one. Claude's adapter in particular tags a subagent's `tool_call` and its final
  `tool_call_update` and leaves the one in between untagged.
- A subagent's mark is the same icon-and-colour pair a session gets (`RuntimeStateIcon.tsx`), so a
  running child turns the same loader as a working session: one glance answers "is this moving?" for
  both kinds of row. Its line names the status, the role where that is not already the title, and the
  model. Codex never names a child's model and Claude only names it once the child has finished, so
  until then the line shows the session's own, which is what a child inherits unless the spawn asked for
  another. The token count is collected on the roster but not shown: Codex's arrives in bursts and
  Claude's only at completion, so the number a reader watched was mostly stale.
- What reaches a subagent's stream is narrower than its parent's, and it differs by harness rather than
  by choice: a Codex child sends prose, reasoning, tool calls and diffs, and its own status becomes the
  row rather than cards; a Claude subagent sends tool calls and diffs only, since the CLI does not
  forward a subagent's prose. A Codex child's plan is dropped, because `plan` carries no
  attribution and a child's plan is not the session's.
- Selecting a sub-row, or the card's own **Open**, moves the whole message window onto that subagent's
  run: the transcript renders the card's children as its top level and a header names the subagent, with
  the way back to the session's own stream. A complex child run does not fit in a box inside its
  parent's stream. The projection already builds the tree, so this is a choice of root rather than a
  second transcript, and the scroll memory keys on the view rather than the session so stepping in and
  out does not restore one list's offset onto another. Picking the session row in the sidebar comes back
  out. The composer is hidden while a subagent's run is showing: it only ever addresses the session, so
  leaving it there would read as a way to reply to the subagent, which neither harness offers. The draft
  is held per session outside the component, so stepping in and back does not lose typed text — and so
  does everything else about the unsent turn, which is what lets the run pane draw a second composer on
  the same session.
- The composer's field is the kit's `MentionTextarea`. It draws `@file`, `/command` and `$skill` in
  three role tones, `accent`, `warn` and `ok`, which the theme maps the same way it maps every other
  tone; the composer names a meaning per run of text and never a colour. A textarea cannot colour part
  of its own value, so a `<pre>` mirrors the draft over it and the field's own text is transparent. The
  two share every property that decides where a glyph lands, and above 20,000 characters the mirror is
  dropped and the field paints itself. A command or skill is coloured only when the session advertises
  that name, so `9/11` stays prose and a misspelled `/reviw` stays visibly plain. File mentions come
  from the same walk that builds the turn's file parts, so what is coloured is what is sent.
- Typing any of the three sigils opens the same dropdown: `@` lists worktree files, `/` the commands
  and `$` the skills the session advertises. Rows are `PickerRow`, the row the context picker draws,
  so a name sits over its description rather than sharing a line with it. The list scrolls once it
  passes 280px, and the arrow keys scroll it themselves rather than calling `scrollIntoView`, which
  would be free to scroll the transcript behind the composer as well. Only `@` waits on a fetch, so a
  command list that arrived with the session is never held behind the worktree walk. The `＋` picker
  still inserts the same tokens for anyone who would rather browse than type.
- Hovering a coloured command or skill shows its description, through the app's `data-tip` tooltip.
  The mirror is inert except for those spans, which take the pointer and hand the caret straight back
  to the textarea on mousedown, so clicking a token still puts the cursor where it was clicked.
- ⌘⇧↩, or the expand button in the corner of the box, grows the field from three rows to eighteen. It
  is the same chord the shell uses to maximise a pane and the nearest meaning it has while the caret is
  in a textarea. It is not a registered keybinding, because a task-scoped binding never fires from
  inside a typing target and a rebindable row that did nothing would be a lie. The transcript yields
  the height and keeps its place, because the timeline is the scroller and shrinking it does not move
  what it is following. The state is session-only and per composer, which is deliberate: two panes open
  on one session are two readers, and a reader expanding the box in one has not asked the other to
  change shape.
- **The composer has two more slots.** `agents:attachment` decides how one attachment on an unsent
  turn is drawn, keyed by its media type and in `replace` mode, so a plugin that knows more about a
  `.png` than a chip can say draws it instead and one attachment is still exactly one chip.
  `agents:composer-actions` is room in the action bar beside Attach and the two pickers, in `stack`
  mode with a ceiling of four, because several plugins with something to offer a draft is a real
  answer for a toolbar. Both follow the same four rules as every other point
  (docs/plugins.md § Cooperative extension points).
- Changing a provider config option — the model, the reasoning level, the permission profile — writes
  a row into the transcript, so reading back a session shows where the switch happened rather than
  leaving every later turn to be read under whatever the setting is now. The switch also becomes the
  default the next session starts on, described under New-session defaults below.
- Terminal handoff transfers an exclusive input-controller lease to a raw provider TUI. A managed
  session and a raw terminal cannot write the same provider session simultaneously.
- Notifications and the attention inbox represent requests that need the owner. Dismissing purely
  informational UI is client-local.

A session's lifetime is bounded by its task's. Sessions belonging to a task that is no longer active,
whether archived, cancelled, or hard-deleted with its project, are retired. They leave the live list
every glance surface reads (Agent Center, the Fleet stat, the attention inbox, the `sessions`
dashboard collection) and appear in the archived list instead. This is resolved when the list is read
rather than cascaded onto the session's own `archivedAt`, because removing a project deletes its
tasks outright and no cascade would visit those rows. A read that names a task id is exempt, because
the task pane is looking at that task.

Archiving is the only way the UI retires a session. Both the pane header's menu and the three-dot
menu on each row in the task's session list offer rename, archive, and, while the agent is running,
stop; archive asks first. The delete route still exists for a caller that means it, but it is no
longer a menu item one click away from a transcript that cannot be recovered.

### The transcript store

Because nothing is virtualised, the DOM holds every card in a session, and what a streamed event costs
is the only lever there is. `plugins/agents/src/client/sessions/managedStore.ts` holds one snapshot per
session — the session row, its turns, its events and its requests — and every client sees about 25
events a second per streaming session, because the Node coalesces text deltas at 40 ms or 16 KB
(`durableEventBuffer.ts`). Four rules keep that frame cheap, and all four are load-bearing.

- **The event list is kept in sequence order and appended to in place.** Events arrive in order, so an
  arrival is a `push`; a reconnect replay can still deliver one out of order and that walks back from
  the tail to its seat. A set of seen ids per session answers "have I got this one" without a scan.
  Nothing may hold the array across a change and compare it by identity: what makes the transcript
  re-render is the store's signal, not the array's identity.
- **A usage update folds onto the open line** rather than being appended, by the rule above.
- **A projected event asks for a row, not a session.** `user_message`, `request`, `request_resolved`
  and `turn_completed` used to trigger a debounced refetch of the whole snapshot — up to 2,000 event
  rows, with a JSON body parsed per row — to learn one fact. The Node knows the fact already, so it
  sends it: `agent:turn` carries the turn a `user_message` opened or a `turn_completed` closed, and
  `agent:request` carries the request a `request` raised or a `request_resolved` answered. `error` is
  the one type that still refetches, because it also expires this session's pending requests and no
  frame names that set.
- **The turns are a map above the list, not a scan inside it.** A row used to find its turn with
  `turns.find`, once per row per render.

A snapshot read and the socket can disagree about a usage line, because both sides fold it and both
keep the first update's id: a frame can land while the request is in flight. `managedSnapshot.ts`
unions the two payloads, socket first, so no reported field is lost either way.

**The snapshot route caps its event list, so loading a session is a walk, not a read.** `GET
/sessions/:id` returns at most 2,000 events, oldest first, and a session reaches that in about half an
hour of streaming: text deltas land at 40 ms each and a 7,000-event session on this machine's database
is 5,500 deltas against 26 messages. `loadSnapshot` compares the session row's `lastEventSeq` against
the highest event it holds and pages `GET /sessions/:id/events?afterSeq=` until the two agree. Without
that walk the store stopped at the cap, and because the socket appends past it live, the gap only
appeared on a reload — a long transcript reopened hours behind its last message, which read as lost
messages rather than a short read. The events were always in SQLite; the Node commits each one as it
arrives.

### Transcript search

`agent_events_fts` is a SQLite full-text index over `agent_events.search_text`, kept in step by triggers
written by hand into the migrations (docs/data-layer.md § Migrations). Agent Center's search and the
archive page's search provider (docs/plugins.md § Search providers) both read it.

**A streamed message is indexed once, on its first event.** A reply arrives as many `append` events,
and indexing each one on its own meant a search for two words only matched when both landed in the
same fragment. A measured database held 148,570 assistant rows averaging 21 characters. Now a fragment
that continues the previous event's stream (same type, turn and message id, the rule
`durableEventBuffer.ts` coalesces on) adds its text to the stream's first event and keeps none of its
own. Migration `0005_agent_events_fts_messages.sql` applied the same rule to existing rows: those
148,570 became 7,410 messages averaging 445 characters, in 11 seconds on a 1.4 GB database. No
harness writes a final full-text event beside its fragments, so there was nothing simpler to index.

Each fragment rewrites its message's search row, so indexing a message costs its length times its
fragment count. That is small for replies of a few kilobytes. Indexing when the stream closes is the
upgrade if very long replies make writes slow.

**Tool text ranks below the conversation.** Tool events are about two thirds of the indexed rows and
about 1 KB each, and file dumps and command output buried the conversation. They go in their own `tool`
column, and the table's stored rank weighs a word there at 0.3 of the same word in `content`. Searching
for a command someone ran still works.

**Search rows are keyed by the event's rowid.** The triggers used to find a row by `event_id`, which
FTS5 cannot look up, so every update or delete scanned the whole index. Inserts replace on rowid and
deletes also check `event_id`, so an event table whose rowids a VACUUM renumbered repairs itself on the
next write instead of failing it.

The index still stores its own copy of the text, about 300 MB on the measured database. Pointing it at
`agent_events` as external content would save that, but external content is keyed by rowid, and this
table's rowids are not stable across a VACUUM because its key is text.
