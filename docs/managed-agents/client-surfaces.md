# Managed agent client surfaces

Part of [managed-agents.md](../managed-agents.md).

## Client surfaces

Session reads capture their Node and the store generation before dispatch. Snapshot continuation
pages use that captured Node. A switch, clear, or deletion rejects a departed read before it publishes
rows, indexes events, advances completeness, or starts another page. In-flight cleanup and snapshot
holds belong to their generation, so an outgoing surface cannot release an incoming surface's hold.
Agent Center resources and session launch completions use the same ownership check.

Unsent agent payloads belong to a Node and session, including text, attachment ids, and context.
Both composers share hydration and operation guards. Hydration, native pickers, uploads,
replacements, context capture, and sends complete on the captured draft. Successful sends clear text only
when its edit revision matches, and remove the exact submitted attachment and context objects. Switching Nodes preserves unsent
work in memory and in the scoped local record. Deletion invalidates the addressed draft and removes
its storage. Empty settled drafts release their memory when their final surface leaves; dirty drafts
have no eviction cap. A consumed fork draft retains hydration while the Node still advertises its
pending fork context, so remounting cannot attach that context twice. Storage failure retains the
payload in memory and does not schedule replay.

The durable record uses an ownership key shape, `acorn.agent-payload.` followed by the JSON
pair of Node id and session id, with separate `.text`, `.attachmentIds`, and `.contexts` suffixes.
A text edit writes only its field, so a retained context is not serialized on each keystroke. A legacy
session-only payload is synchronously claimed by the first selected Node that hydrates it. Its source
keys remain until all scoped fields are confirmed in storage. An in-memory claim prevents another
Node from inheriting ambiguous attachment ids when storage rejects that claim. If storage rejects
all writes, recovery across an application restart remains limited to the original legacy payload.
Generic task text storage has a separate contract.

Attachment and artifact cards hold an Agents-owned cache entry keyed by Node, media kind, and id.
Consumers share metadata, full bytes, and one data-URL conversion. Downloads reuse the held bytes and
retain the response's media type and filename. One departing consumer does not cancel another's read.
Idle entries retain at most 16 MiB, counting bytes plus two bytes per retained URL character; entries
on screen can exceed that budget. Least recently released idle entries leave first, and failures and
metadata-only entries leave when settled and unused. The raster allowlist and 8 MiB preview limit
remain in force. URLs stay as data URLs, so each DOM image still has its own source attribute.

The agents client claims the `agent` WebSocket channel when its first frame subscriber attaches and
releases it when the last subscriber leaves. Plugin activation holds an application-lifetime
subscription for agent attention. Loading a lazy surface, including an inline diff card, does not
register a channel.

The Agent pane is a `list-detail` layout (docs/panes.md § Layout model). The list column is the task's
roster, with a header region of its own so the count stays put while the list scrolls; the detail
column is the open session. The roster is managed sessions, delegated children, and provider-native
subagents, and nothing else: it used to
carry a third group merging this task's terminals with a run's workflow steps, and both halves have a
better home — the terminal drawer, and the Workflows pane. Nothing in the plugin lays anything out and nothing in it ships a
stylesheet: every surface here is a tree of kit nodes, so the same source draws in the shell today and
through the remote root when a harness plugin is loaded rather than compiled
(docs/ui-design.md § The closed kit).

The header waits for nothing but the module and the session list. The pane's model is built inside
the first region that asks for it, which is this header, so anything the model reads while it is built
holds the header back. It used to read the harness list that way, and the header took as long as the
Node's providers probe, 205 ms typically and 805 ms at the 95th percentile. The harness list is now the
shared `['agents', 'providers']` query (`plugins/agents/src/client/providersClient.ts`), fresh for a
minute, so a second task reads it from memory. The model reads its data only once the query has an
answer. Until then the New menu and the empty state say they are checking which agents this Node can
run. The menu's Refresh button asks the Node for a fresh probe and writes the answer into the query.

The detail column has a header, a transcript and a composer without a second set of regions. The
transcript is a `Timeline` with `follow` set, which means the kit owns the scroll: it stays on the
newest turn until the reader scrolls away from it, picks the bottom up again when they scroll back,
and gives a reader the place they left when they come back to a session. The bar above it and the
composer below it are pinned by being that scroller's siblings.

The conversation is keyed by the resolved session id. The Agent pane keeps its detail region mounted
while the reader chooses another row in the same task, and the Workflows pane can resolve a step's
session after it has mounted. A different id disposes the prior transcript, snapshot subscription,
pending reveal, and local view controls before mounting the new one. Drafts and reading places remain
in their session-keyed stores, so returning to a session restores those separately.

Navigating to an editable session in the Agent pane focuses its message field. Returning to its task
or pane, switching sessions, and selecting the session already on screen all hand the caret to the
composer without scrolling the transcript. Streamed events and session metadata updates do not move
focus. Other surfaces that show the conversation do not opt into this focus behavior.

Immediately after the title, the header hosts the `agents:session-header` remote `stack` point. Its
props are a public projection rather than the ledger itself: task and session ids, provider id,
per-turn usage and resolved prices, and explicit token/cost accounting modes. The owner stops there.
The bundled `agent-cost` loaded plugin prices and formats those facts, preferring provider-reported USD
and otherwise showing an API-equivalent estimate; disabling that plugin removes the badge without
changing Agents. The point is not cost-specific, so independently installed plugins can fill the same
seat with a token counter or budget warning. The pane hands the point a new payload only when it says
something new: every payload crosses to the plugin's worker, and most streamed events change no turn's
usage. The complete contract lives in
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
scroll, replacing the DOM under any text selection.

**A long session is drawn through a fixed window instead.** The projection covers every event, and the
transcript draws the newest 200 cards of it, with **Show earlier (N)** above the first card
(`createTimelineWindow`, `packages/client-core/src/kit/lib/timeline/timelineWindow.ts`, from
`@acorn/plugin-api/ui`). The window counts cards and never measures one, so it has no feedback loop.
The canonical 7,012-event session projects to 3,387 cards. Drawing all of them built about 30,000
elements in about 840 ms in jsdom before anything painted. The window builds about 1,800 elements in
about 60 ms (2026-09-26, jsdom, no real-window timing). Its rules:

- The window is held by its oldest drawn card, so a streamed card joins it and never pushes a card
  out. **Show earlier** adds 200 older cards and keeps the card the reader was looking at at the
  same offset.
- **Go to top** above the composer draws every card, then jumps to the oldest. That is the explicit
  way to reach the start in one step, and to let the page's own find see the whole session. Until the
  reader asks, the page's find cannot match a hidden card, and the count on **Show earlier** says so.
- A remembered reading place in a hidden card, and a request a notice or the sidebar names, reveal
  the page that holds the card before anything is focused or scrolled. Only a card that has left the
  list for good hands the reader a neighbour, and the Timeline's health counts that as a
  substitution. A named request is revealed once per view, so a later trim can drop it again.
- While the reader follows the live end, the Timeline trims back to 200 once it draws 400, which is
  once a page of new cards rather than once an event. It never trims a card holding the selection or
  focus, and it never trims while the reader is away from the live end. The trim runs in the frame
  after the list grows, not inside the resize callback, so the browser never reports a resize loop.
- Switching session or subagent starts that list on its own newest page. The window is not kept per
  session.
- Each card carries `aria-posinset` and `aria-setsize` for its place in the whole session, so a screen
  reader hears "3,188 of 3,387" rather than "1 of 200".

The terminal client draws the same window and the same control and never trims.

The window shipped because of a count, not a timing. At `canonical` the transcript mounted 3,387
turns, eight times the 400-turn ceiling the large-surface flow asserts ([desktop and large-surface tests](../testing/desktop.md)
§ The large-surface fixture), and stable keys and lazy bodies alone did not reduce card construction. The
200-card page comes from that jsdom construction count. No WebKit sample has refined it.

What the transcript refuses, and what would reopen it:

- **A variable-height virtualizer.** The last one cleared its measurement cache on every event and
  replaced the DOM under a selection. Reopen it only if a product requirement rejects **Show
  earlier**, and a prototype keeps selection, focus, reading place, streaming and measurement intact
  on the `canonical` fixture in the real window.
- **Dropping old events or cards to meet a budget.** The projection stays complete. The window changes
  which cards are mounted and always offers a way to draw the hidden ones.
- **`content-visibility` on turns.** It was tried in the real window on 2026-09-30, on the
  `canonical` fixture, with `content-visibility: auto; contain-intrinsic-block-size: auto 48px` on
  `.ui-timeline-turn`, and backed out. The accessibility tree is what rules it out. WebKit lays out no
  text in a skipped turn, so its static text reaches the macOS accessibility API empty: 410 of 445
  text elements in the drawn window, against 21 without it. A screen reader reads blank cards for
  everything off screen, and no stylesheet rule changes that. Paint containment also clips the focus
  rings drawn outside a turn's edge. A named card's reveal fails too. Drawing the cards near the new
  position resizes the list before the scroll event arrives, so the Timeline still reads the reader
  as following and pins them back to the newest turn. The Timeline now checks for a move before a
  resize pins, so that one would not recur ([closed-kit.md](../ui-design/closed-kit.md)); the
  accessibility tree still rules the property out. Selection, page find, the reading place and
  following the newest turn all held. The gain was small at the window's size. With 200 cards drawn,
  their first style and layout went from about 10 ms to about 7 ms, and a full relayout from about
  3 ms to under 1 ms. With all 3,387 drawn, after **Go to top**, those were about 190 ms to 137 ms,
  and 48 ms to 10 ms. Reopen it only if WebKit exposes skipped text to accessibility.

Known limits of the window:

- Turning **Chats only** off keeps the oldest drawn card, so the window can grow to about 600 cards
  until the next trim.
- After **Go to top** on a stopped session, returning to the live end does not trim. A trim runs only
  when the list grows, and a stopped session does not grow.
- A reading place stores its turn's index among the drawn turns. When that turn has gone for good,
  the neighbour is picked from what is drawn, which can differ from the logical neighbour after the
  window changed.

Two more guardrails hold in the same place. A card seeds its fold state at mount and then leaves it alone, so
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
  Its header places the active, attention, and session counts side by side. Provider health appears
  in compact cards with each name and status dot; the fleet scope also explains remote refresh timing.
  Its archived filter offers **Restore** on a session someone archived on its own. A session retired
  because its task was archived has no such button: it comes back when the task is restored, because
  retirement is worked out when the list is read (docs/workspaces-and-tasks.md § Restoring a task).
- On an archived task, which only the archive page's preview shows, the Agent pane is read-only: the
  transcripts draw, the composer is off, and there is no new-session picker.
- A provider draws as its own mark wherever it is named: the onboarding cards, the New picker, each
  harness row and block in Settings -> Harnesses and defaults, and the session icon in Agent Center. The name comes off the
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
  module map keyed by Node and session (`plugins/agents/src/client/composer/composerState.ts`) rather than in
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
- Claude's `Skill` call uses the skill name in its recorded JSON input for the built-in card's label:
  **Launching skill: readable** rather than **Skill**. Opening the card shows the original JSON.
  If the provider's output repeats that same sentence, the expanded body omits the duplicate. This is
  a presentation rule, so previously recorded calls gain the label without changing stored events.
- Claude's `ToolSearch` call, which loads a tool's definition before its first use, renders as a flat
  row named after what it loaded: **Load tools: WebFetch** rather than **ToolSearch**. Its JSON
  input and its `Tool: WebFetch` output both restate that name, so the ACP normalizer drops them
  unless the call failed. The names come from the structured response's `matches`, so this is a
  normalizer rule rather than a presentation one, and calls recorded before it keep their old card.
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
  The Timeline's health counts built bodies apart from cards (`mounted.bodies`,
  [telemetry.md](../telemetry.md) § Rendered-surface health). A compiled contributor's card, such as
  `changes`' file tool card, uses the same disclosure and defers the same way. A loaded plugin's remote
  tree is the exception: the worker builds its whole tree, closed body included, for every card the
  window draws, because the host cannot see inside it to defer anything.
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
- **A file tool opens onto its recorded diffs.** The transcript matches per-file changes to a
  tool by turn and change id, then passes them through the `agents:tool-card` contribution as
  `fileChanges`. The Changes plugin's file-tool card and the generic fallback draw these patches
  with `StackedDiff`, the kit's read-only unified diff, with addition and deletion backgrounds,
  line numbers, and an **Open in Changes** button. Paths covered by a patch are not listed again
  beneath it. The Changes card shortens paths in its disclosure label to the final two components;
  the diff header keeps the complete recorded path. Rows are built on first open. A streamed patch
  updates the open card without closing it. Excerpts leave their line numbers blank. Oversized
  patches report that they are too large to show; missing patches report that no recorded diff is
  available. Both keep the Changes action.
  The associated standalone file-change row is hidden only after its tool can display it. Unmatched
  changes, including truncated history and events without change ids, remain visible. Whole-turn
  diffs keep their own disclosure. The recorded patch describes that edit when it ran; the Changes
  pane reads the working tree. The ledger remains unchanged, and each change still folds by change
  id and path ([managed-agents.md](../managed-agents.md#file-changes)). The terminal client draws the
  same cards through its own `StackedDiff`.
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
  one id. The ledger stores it as two rows, its opener and its latest state (§ The transcript store
  below). When the client sends `fold=1`, the snapshot route and the event pages behind it fold each call's updates within the page
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
  the turn had used on the right. The fold in `conversationItems.ts` copies the figure onto the
  `turn_completed` card by position rather than by turn id, and again when a late usage update moves
  it, because Codex clears the current turn
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
- An app-access approval names its app by the name a person reads and the identifier the grant is
  keyed on, and says what each scope means before any button (`client/sessions/appApproval.ts`). The
  buttons are the stored options, so **Always allow** appears only when the provider offered it. Once
  answered, the record keeps the app and identifier. After **Always allow** it also says that the
  provider saves the grant and where to revoke it, because a sent answer is not proof of a saved grant
  ([managed-agents.md § App-access approval](../managed-agents.md#app-access-approval)). The desktop
  and the terminal draw the same card.
- **Chats only keeps the requests.** The toggle above the composer drops the tool calls, the reasoning
  and the notes, and a question the agent asked with the answer sitting on it is the same conversation
  as a message. During planning it is most of the conversation, so leaving it out gave a reader a
  transcript where the agent settled a question it had never asked. An answered permission is already
  gone by then, dropped by the rule in the bullet above rather than by a second one here, so what
  survives the toggle is the questions and whatever is still blocking.
- The task sidebar keeps its own "Needs you" list, which is the way to reach a blocked session the
  reader is not looking at. Picking a row opens that session and brings its card into view.
- Managed sessions, Workflow runs, and Inline chats each have an order button in their header:
  running first, name, newest first (the default), or latest activity. The choice is saved per task
  and per group as the `agents.session-order` state slice (plugins/agents sessions/sessionOrder.ts).
  Subagents and delegated children follow their group's order and have no control of their own.
  Latest activity reads the session's `lastEventAt`, not `updatedAt`, because opening or renaming a
  session also moves `updatedAt`. The node leaves `lastEventAt` out of the row-change check (as it
  does `updatedAt`), so the order re-sorts when a turn starts or ends, not on every streamed chunk.
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
  from the same worktree file list that builds the turn's file parts, so what is coloured is what is
  sent. An `@` token with no exact file match stays plain message text and does not block sending.
- Typing any of the three sigils opens the same dropdown: `@` lists worktree files, `/` the commands
  and `$` the skills the session advertises. Rows are `PickerRow`, the row the context picker draws,
  so a name sits over its description rather than sharing a line with it. The list scrolls once it
  passes 280px, and the arrow keys scroll it themselves rather than calling `scrollIntoView`, which
  would be free to scroll the transcript behind the composer as well. Only `@` waits on a fetch, so a
  command list that arrived with the session is never held behind the worktree walk. That fetch starts
  when the field first takes focus, not when the composer mounts: the list runs to about 145 KB, and
  most visits to a task never type `@`. The `＋` picker
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
is the only lever there is. `plugins/agents/src/client/sessions/managedStore.ts` holds one snapshot for
each session it keeps — the session row, its turns, its events and its requests — and every client sees about 25
events a second per streaming session, because the Node coalesces text deltas at 40 ms or 16 KB
(`durableEventBuffer.ts`). Five rules keep that frame cheap, and all five are load-bearing.

- **The event list is kept in sequence order and appended to in place.** Events arrive in order, so an
  arrival is a `push`; a reconnect replay can still deliver one out of order and that walks back from
  the tail to its seat. A set of seen ids per session answers "have I got this one" without a scan.
  What makes the transcript re-render is the store's signal, not the array's identity. The one reader
  that keeps the array's rows across a change is the transcript's projection, and it checks each of
  them by identity rather than trusting the array to be as it was (the last rule below).
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
- **An event costs the projection one row, and wakes only the card it changed.** The transcript keeps
  its fold open (`createConversationProjection` in `conversationItems.ts`) and adds the rows that
  arrived since the last event, through the same code a full build runs, so a long session no longer
  re-projects every row per event. It first checks, by identity, that every row it already took is
  still in its place, and that the new ones follow in sequence order. The store's in-place merge of a
  usage update is the one change it takes as it is; a row seated behind the tail, or a re-read that
  replaced a record, rebuilds from the start. An item the fold did not touch keeps its object, and each
  row reads its item from a signal of its own that is written only when the object differs, so one
  event redraws one card. A rebuild hands out new objects throughout, because it happens exactly when
  a card can have gained a row without its key or its sequence span moving. The turn and request maps
  are memoised on their arrays, which the store replaces only when a turn or a request changes.

**A frame costs about a millisecond, so frames are not batched.** In the plugin's jsdom tier, with
the canonical session in the real store and the real transcript drawing 200 of its 3,387 cards, a
streamed message delta took 0.8 ms at the median and 1.3 ms at the 95th percentile, and stayed near
1 ms as one reply grew to 40 KB. A tool update took 0.5 ms. The store write itself was under 0.05 ms.
The one expensive frame is an event seated behind the tail, which rebuilds the projection and wakes
every drawn card: about 20 ms. The node commits a session's events in order, so a live frame does not
arrive that way. Sentry agrees: over three days, the slowest agent frame in the median five-second
window took 1 ms, and in 95% of windows it took 36 ms or less. Frames of 100 ms or more are a tail
under 1% of frames. Batching frames into one write per animation frame would not change that, because
one session's frames arrive about 40 ms apart and a batch would nearly always hold one frame.

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

**A session the store holds is read on from its mark, not from the start.** The Agent pane loads the
session every time it mounts, which is every switch back to a task with an agent open, and each of
those loads used to fetch the whole ledger again. The store keeps a mark per held session,
`completeThrough`: every event at or below that sequence is held, or folded into a row that is. A
load sets it to where its walk ended. A streamed event moves it only when it is the next sequence, so
a frame the socket lost leaves the mark at the gap and the frames after it cannot hide it. The next
load asks the snapshot route for events after the mark and pages on from there. Nothing below the mark
can have changed in a way the reader would draw: the ledger appends, and the one row it deletes is a
tool call's or a file change's superseded row, only once a newer row carries the card's whole state
(below). The retention pass is the exception. It deletes every row of a long-archived task's session
and appends a note past them, so a window holding that session draws the old rows until it reloads
([managed-agents.md § Operations and failure](../managed-agents.md#operations-and-failure)). The turns, the requests, and the row still come
back whole, because some of their changes reach the socket as no frame at all: a turn queued from
another window, a request that a stop expired. So a resumed read answers what a full read would. When
it brings no events, the held array passes through unchanged and is not indexed again. A shown
conversation also reads on when the socket reconnects (`wsOnReconnect`), because nothing replays the
frames a dropped socket missed. A session that is not on screen catches up when it next mounts.

**The store keeps the snapshots on screen and the three drawn last, and drops the rest.** It used to
keep every session it had read until the session was deleted or the node switched, and eight real
sessions opened one after another came to 46 MB of JSON. A surface that reads a session's snapshot
holds it through `managedAgentStore.hold(sessionId)` for as long as it draws it: the conversation
holds its session, and the task sidebar holds each session waiting on the reader, whose requests it
lists. Releasing a hold counts as the latest drawing. Past the three most recent, a snapshot that
nothing holds and nothing is reading drops its events, its seen ids, its usage line and its
`completeThrough` mark. The row stays in the roster, so the rail, Agent Center and notices still draw
it, and so do its composer draft, its reading place and its live event sequence. A frame for a
dropped session appends nothing, and an `error` frame for one reads nothing. Opening it again is a
first visit: the read starts from the beginning.

**A tool call is stored as two rows: the one that opened it and one with its latest state.** A
harness reports a call as a run of updates on one id, and each used to be a row. A measured database
held 196,000 tool rows for 39,000 calls, 300 MB of JSON, and every reader folds them into one card
anyway. The updates are partial: a field left out means unchanged, and Codex streams output as
appends. So when an update arrives, `recordEvent` folds the card's stored rows and the update with
`mergeToolCall`, writes the result at the next sequence with no `outputAppend`, and deletes the row it
supersedes, all in the event's own transaction (`server/sessions/ledgerFold.ts`). A file change with a
change id is stored the same way, with its latest report as the state. One without a change id is
never folded by the transcript, so it is not folded here either.

Each reader stays correct for a reason of its own:

- **Resuming after the mark.** The new row is past every mark, so a reader resuming from its mark gets
  it, and it replaces every field the reader's card could hold. An update in place would have sat
  below the mark and never reached it, which is why the fold writes a new row.
- **Reading from the start, and the `fold=1` pages.** They see the opener and the latest row, which
  fold to the card they always drew. The opener stays because every reader puts a card where its
  first row landed, keys it by that row's id, and files it in the subagent stream that row names.
  Deleting it would move a call to where its last update landed on the next reload.
- **The socket.** Each update still goes out as the provider reported it, at the sequence its row
  took, so frames stay the size of the change and `completeThrough` still moves one sequence at a
  time. A snapshot read that lands after a frame replaces it by id (`managedSnapshot.ts`), and the
  stored row folds to the same card.
- **The walk and `lastEventSeq`.** Sequences now have gaps, and nothing reads them as contiguous. The
  deleted row is never the session's newest, so the walk still ends on `lastEventSeq`.
- **Export, the wait route, workflows and delegation.** They read the rows as stored. The markdown
  export folds tool rows so each call is one line with its last status. The others read messages,
  turn ends and errors, which are never folded.

Rows stored before the fold are put into this shape once, in the background after boot
(`server/sessions/ledgerCompaction.ts`). Each card keeps its opener and its last row, rewritten in
place to the folded state, and loses every row between. Rewriting the last row is safe for the same
reason the new row is: it folds to the same card over whatever prefix a reader holds. The pass works in
small transactions and yields between them, marks each session on `ledger_compacted_at` when done, and
reads only unmarked sessions, so it finishes once. On the 1.3 GB database it was written for, it
removed 118,500 rows in 34 seconds, and the median step held the node for about 3 ms. The longest,
one card of about a thousand rows, held it for about 190 ms. It then merges the search index, because
each deleted row left a tombstone there. The file does not shrink; see docs/data-layer.md § Retention.

### Transcript search

`agent_events_fts` is a SQLite full-text index over `agent_events.search_text`. Migration-owned triggers
project standalone rows and explicit search-text changes. The Node-owned `AgentSearchProjection`
materializes streamed message heads before reads that require them. Agent Center's search and the
archive page's search provider (docs/plugins.md § Search providers) both read it. When the retention
pass removes a session's history, the delete trigger takes its rows out of the index, so archive search
stops finding it. The session's title still matches, and so does the note left in its place
(docs/data-layer.md § Retention).

**The search text stays on the node.** An event record's `searchText` is the index's input, and no
client reads it. On a tool row it repeats the title, input and output the event already carries, which
made it a third of the agent socket's bytes. The snapshot route, the `/events` pages and the
`agent:event` frame leave it out (`clientEventRecord` in `server/sessions/rowMapping.ts`). Export, the
wait route and the node's own readers still get the whole record.

**A streamed message is indexed once, on its first event.** A reply arrives as many `append` events,
and indexing each one on its own meant a search for two words only matched when both landed in the
same fragment. A measured database held 148,570 assistant rows averaging 21 characters. Now a fragment
that continues the previous event's stream (same type, turn and message id, the rule
`durableEventBuffer.ts` coalesces on) adds its text to the stream's first event and keeps none of its
own. Migration `0005_agent_events_fts_messages.sql` applied the same rule to existing rows: those
148,570 became 7,410 messages averaging 445 characters, in 11 seconds on a 1.4 GB database. No
harness writes a final full-text event beside its fragments, so there was nothing simpler to index.

A continuation commits its canonical JSON and sequence without concatenating or reindexing the head.
Migration `0012_agent_search_progress.sql` records the earliest dirty sequence per session in the
same SQLite transaction, including direct inserts, canonical updates, and deletions. The projector
starts at the preceding materialized head, reads 128 canonical rows at a time, joins each complete
message, and writes only changed heads. It retains one page and one message head's materialization during catch-up, with
no message cache or timer. Whole messages retain phrase, split-word, stemming, prefix, and ranking
semantics. A query after every fragment still pays the full growing-message indexing cost.

Both search entrypoints catch up every dirty session before ranking, including sessions outside the
task filter because they affect corpus statistics. Catch-up, ranked rows, snippets, and session reads
share a synchronous SQLite transaction. Agent Center resolves workspace task IDs through CoreServices
before entering that transaction. Its tied ranks still sort by descending session update time; the
archive provider retains FTS rank order for ties.

Raw `snapshot`, `eventPage`, `eventsForTurn`, and `exportSnapshot` reads catch up their session inside
the read transaction. Wait, execution, delegation, fork context, and transcript export therefore keep
complete derived heads. Client snapshots and event pages select no search-text bytes and skip this
barrier; their records omit `searchText`. A stream boundary, provider retirement, and runtime shutdown
also flush committed dirty work. Failed projection rolls back without discarding its dirty marker.

Before the first projection read or event write, the Node reinstalls missing derived objects, checks index integrity and event-row
identity, and marks canonical sessions for reconciliation. This covers lost markers and stale
progress after interruption. A missing, inconsistent, or corrupt index is rebuilt from canonical
message JSON and the ledger's folded-card exclusions. Recovery holds no asynchronous projection task,
so deleting a session cannot revive it. Applied migrations remain unchanged.

**A tool call is indexed once, on its latest row.** That row holds the whole call, so the opener gives
up its search text when the first update folds onto it. A file change does the same.

**Tool text ranks below the conversation.** Tool events were about two thirds of the indexed rows and
about 1 KB each, and file dumps and command output buried the conversation. They go in their own `tool`
column, and the table's stored rank weighs a word there at 0.3 of the same word in `content`. Searching
for a command someone ran still works.

**Search rows are keyed by the event's rowid.** The triggers used to find a row by `event_id`, which
FTS5 cannot look up, so every update or delete scanned the whole index. Inserts replace on rowid and
deletes also check `event_id`, so an event table whose rowids a VACUUM renumbered repairs itself on the
next write instead of failing it. Recovery reconciliation also detects rowid drift and rebuilds the index
before search reads it.

The index still stores its own copy of the text: 203 MB on the measured database once the tool rows
were folded, down from 326 MB. Pointing it at `agent_events` as external content would save that, and
it was considered and left alone. External content is keyed by rowid, and SQLite allows a VACUUM to
renumber the rowids of a table whose key is text, as this one's is. The current table survives that,
because it stores `event_id` and every delete checks it. An external-content table cannot check: its
matches would read the wrong rows, and a delete that names values the index does not hold corrupts it.
Making the rowid stable means rebuilding `agent_events` with an integer key, and the switch means
reindexing every row inside a migration, which blocks boot. The content and tool columns would also
need a view, because the triggers split them on the event type.
