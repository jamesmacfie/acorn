# Command palette and shortcuts

Keyboard commands are registered by the shell and feature contributions.

**One session draws both palettes.** `client-core/host/registries/commands/session.ts` owns what is
open, where in the command tree it is, what is under the cursor, and what pressing Enter does. The
desktop's `CommandPalette.tsx` and the terminal's `chrome/Palette.tsx` render it and bind keys to it;
neither fetches a row or invokes one. Until 2026-09-03 each host did all of that itself, twice, which
is why a nested or asynchronous command could not be added to one without being reproduced in the
other.

**A command may be a group.** `CommandContribution` is a discriminated union — an action, a group, a
search, an input and a setting — and a static command may name a group registered by the same
contributor as its `parentId`. Cross-contributor parenting is refused, and so are duplicate ids, a
parent that is not a group, and a cycle: each becomes a dropped node and one diagnostic rather than a
palette that will not draw (`registries/commands/graph.ts`).

**Empty root lists top-level commands; a typed root searches everything.** A query at the root indexes
every available command at any depth against its title, keywords, hint and joined breadcrumb, and a
hit below the top level shows the trail it came from — so hierarchy reduces noise without making a
command undiscoverable. Inside a group the query narrows that group's own children.

**Enter enters, Escape goes back.** Enter runs a leaf and pushes a group. Escape pops one frame and
restores that frame's query and cursor exactly, because the whole frame object was kept rather than
rebuilt; at the root it closes and hands focus back. Focus is restored on the final close and never on
an intermediate pop. Backspace edits the query rather than implicitly popping.

**A shortcut aimed at a group opens the palette at it.** The keymap remains the only global
dispatcher: it hands a command id to `executeCommand` whether the command is a leaf or not, and a
command with no executor is passed to the registered palette presenter, which opens the session at that
command's frame (`registries/commands/presenter.ts`). A leaf named that way opens at its parent with
the cursor on it.

**A command may also be a search, an input or a setting.** A `search` command owns the field: the host
debounces the typing (250 ms and two characters by default), asks its provider with an `AbortSignal`,
and draws the instruction, loading, empty, error or result state that came back. An `input` command is
never debounced — the reader presses Enter once, sees a pending row, and cannot submit twice — and a
failure keeps the frame, the text and the message. Nothing is scheduled while an IME is composing a
character; the end of the composition schedules once.

**A setting shows what is set before it changes it.** Entering a `setting` frame asks its owner what
the value currently is, draws the two-to-thirty-two declared choices, and marks the one that is set.
Picking a choice writes it, keeps the frame open, and marks whatever the owner says it *stored* — never
what was asked for, so a failed write leaves the list telling the truth. A value naming none of the
declared choices is refused rather than shown, a stored value the choices do not name leaves the list
unmarked, and a failed read is one line that Enter reads again. Typing narrows the choices and asks
nobody anything.

Every Boolean setting is an explicit On and Off rather than a blind toggle, so the command shows the
current value and means the same thing pressed twice. Free text, secrets, dependent fields and
anything that saves several values at once stay Settings pages.

**A stale answer cannot land.** Every request carries a generation taken when it was scheduled, and an
answer is applied only if that generation is still current. The abort is the optimisation and the
generation is the correctness, because a provider is free to ignore its signal and some do. A new
query, a pop, a close, or the world moving under the session all abort what is outstanding.

**A command says which identity it is about.** `scope` is `none`, `task`, `project`, `workspace`,
`node` (the default) or `fleet`. A command whose scope names an identity the session did not capture
is not offered and cannot be opened at by shortcut. `node` is where a request goes rather than a gate,
because a client serving its own origin has no node id. Only `fleet` fans out: it asks the host's
fan-out adapter for its nodes, runs one request each, namespaces every row as `<nodeId>:<itemId>`,
carries the node's label into the row, and keeps one node's rows when another's request fails.

**A command says what happened.** An action returns nothing, which means close; `{ effect: 'stay' }`
keeps the frame open and may carry a line to show; a throw or a rejected promise keeps the frame open
with the message on it. A second Enter while one is in flight is ignored. A loaded plugin's action is
awaited now, so a `runNodeAction` the node refused keeps the palette open with the node's own message
instead of closing over it; every other click site discards the same promise and still gets its toast.

**The session closes when the world moves under it.** It captures one immutable execution context —
host, node, workspace, project, task, pane, surface — when it opens, and passes that to every provider
and executor. An external change to the node, workspace, project or task closes it and aborts what is
outstanding; a command that navigates closes through its own outcome first, so its error still has
somewhere to be reported.

**A setting has one accessor, and the page and the command both call it.** There is no reflection of
Settings pages into commands: a page is an arbitrary component, and scraping one would couple the
palette to rendering and create a second persistence path. An owner opts a value in by registering a
setting command whose reader and writer are the ones its page already uses — Appearance's five choices
and the six notification switches are core's own, in
`client-core/host/registries/commands/coreCommands.ts` over
`features/settings/appearancePrefs.ts` and `features/notifications/settings.ts`. The host that
contributes those Settings pages is the host that registers their commands, so a client with no
Appearance page has no Appearance command to disagree with it.

**Core's own catalogue is a small tree.** `Go to` holds the task, workspace, project and node
searches and the `Last workspace` action, `Panes` and `Terminal` hold the task-scoped operations that
were loose at the root, `Settings` holds one row per registered settings page, and `Appearance` and
`Notifications` hold the settings core owns. Going to a task or a workspace was a special kind of
palette item until 2026-09-03, composed into the root by hand and invoked through a switch on what a
row was about; it is a `fleet`-scoped search now, so the root shows one named row instead of every
task the fleet has, and switching node still happens before a remote task is activated.

**`Last workspace` is an action, not a search, and it is the same pair both ways.**
`client-core/features/workspaces/lastWorkspace.ts` holds one workspace id: the one open before this
one. Each shell reports the workspace it has settled on — the desktop from the route, the terminal
from its own choice — so opening a task in another workspace counts as a switch and the picker is not
the only way to move. Going back reports the arrival in turn, which makes the workspace just left the
way back, so `meta+;` on the desktop and `;` in the terminal swap the same two workspaces for as long
as the reader keeps pressing. The store keeps an id rather than a node, and the desktop looks that id
up against the fleet when the key is pressed, so a workspace on a node that has come back is found
again. There is no third step back: this is a toggle, not a history, and the row is hidden until a
second workspace has been opened.

**Every row in the palette is a command.** There was a second way in until 2026-09-03: a
`paletteRows` contribution, with `rows` and `invoke` where a command has `run`, fetched by each host
when the palette opened. It solved ownership — no host switched on a plugin's row kind — and it cost
everything else. A row source had no owner, no capability gate, no disposal and no shortcut, so each
of those had to be arranged for it separately; it refreshed on open rather than on the query; it
carried a task id rather than an execution context; it could express no child, no input, no setting
and no cancellation; and only a compiled plugin could supply its callbacks, so a loaded plugin could
never contribute a live row at all. Its last two contributors — the terminal's run targets, layout
recipes and live sessions, and the workflow definitions — are `search` commands their plugins register
through `ctx.commands`. The registry, `ctx.paletteRows`, the two published types and the session's
row-provider seam went with them; `PLUGIN_API_MAJOR` moved to `10` for the two names
([plugins.md](./plugins.md) § The plugin API). Ownership, capability gating and disposal come with a
command registration, so disabling a plugin takes its group and everything under it out of the graph
together.

Five architectural rules in `tools/arch/boundaries.test.ts` hold the shape: there is one
`createCommandSession` and both hosts build theirs from it; neither host's palette files compose,
fetch, rank or invoke; no manifest frame target and no slot id is the palette; a search response
carries no field naming an action, a route, a URL or a verb; and there is no palette-row registry
beside the command one.

Each plugin's catalogue is short on purpose. The editor contributes quick-open and find-in-files;
github a changed-file finder, a pull-request finder, create-a-pull-request and its rail source; agents
the Agent Center, a session search, the two harness terminals and two settings; docker an open action
and one search over containers, images, volumes and networks; terminal a run-target search, a layout
search and a session search; workflows a definition search, a run search and a create action; database and http their groups of saved
rows and one submitted input each; linear and rollbar an issue search each; memory a search and the
proposals view; notes a three-scope finder and a create-a-note input; changes, context and preview one
open action each; and onboarding none. Each plugin's own document has the whole of its share under
"From the command palette". What is *not* there is the point: stopping an agent, removing a container, deleting a
note, merging a pull request and approving a workflow gate all need context and a confirmation that a
low-context row cannot carry, so they stay in the surfaces that have both.

## Global commands

| Shortcut | Action |
| --- | --- |
| `⌘K` | Open command palette |
| `⌘P` | Go to a file in the worktree (the palette, at the editor's search) |
| `⌘L` | Open workspace switcher |
| `⌘⇧N` | Create a local task |
| `⌘⇧T` | Toggle terminal drawer |
| `⌘1`–`⌘9` | Activate the corresponding visible task |
| `⌘,` | Open Settings |
| `Shift+F10` / menu key | Open the context menu for the focused row (the platform fires `contextmenu`; the shell does not bind this itself) |
| `Escape` | Close the topmost overlay or cancel the current action |

The exact platform modifier is handled by the keyboard layer. Inputs, editors, terminals, and
contenteditable elements stop global commands unless a command explicitly opts into text handling.

## Palette data

Every row the session draws is a `SessionRow`: an id that is stable across a refresh, a label, an
optional hint, an optional badge, an optional breadcrumb, and one of three actions — enter this
command's frame, run this, or nothing. That last one is a line that explains why the list is short,
and it is never the selection. The renderers get that and no more: neither of them knows what a run
target, a task or a Rollbar issue is, which is what stopped the two of them drifting apart.

Rows can be static or task/Node-backed. Fleet rows carry a Node label and tolerate partial
availability. A row action targets the Node that owns its resource; no aggregate action pretends to
be cross-Node atomic.

Run targets, layout recipes and workflow definitions come from the Node's task configuration, read
once when their frame opens and filtered on the device after that. Pane and source commands are
registered by their owning plugin. A loaded plugin's manifest `commands` descriptors are
promoted into the same command registry: one command supplies both its optional palette row and any
keybinding target. The older manifest `palette` array is a compatibility alias for a command with
`palette: true`; it is rewritten into one at registration and never produces a second row.

A manifest may declare an action, a group, a search, an input or a setting
(`docs/plugins.md § Command kinds`).
A declarative search names a route in the plugin's own namespace and one static verb for the row that
is picked; the host sends the query and the identifiers the declared scope owns, drops every field of
the answer it does not name, caps the rendered set, and runs the manifest's verb. A response cannot
name a route, a URL, a command or a verb, which is the whole of why a plugin's live rows are safe to
draw in a host surface.

The verb a search picks a row with may be `navigate`, which no other command may name. Rollbar and
Linear both use it: their item detail belongs to the project rather than to a task, so picking a row
changes the URL and the surface beside the rail list follows, exactly as clicking the same row in that
list does. It is available there and nowhere else because it needs a selected row and a routed
project, and a search at project scope is the one command site that has both. The address is still
minted from the pattern the host registered, with the row's sanitized id as the item.

`surfaceAction` is the other verb worth naming here, because a command is the only click site it is
useful from: it delivers the command's own id into a region of one of that plugin's own panes, and the
plugin handles it as it would its own button click. Database's `Run query` and HTTP's `New request`
are the two: running the editor's SQL and starting a blank draft are both things that happen inside a
pane, not routes on a node. A pane nobody has open has nothing listening, which is the honest outcome
for "do this in the thing I am looking at".

A declarative setting names two routes in the plugin's own namespace and a static list of choices.
The host GETs the read route when the frame opens and PUTs the write route with the chosen value plus
the identifiers the declared scope owns; both answer `{ value }`, and a value naming none of the
declared choices is refused on the way out and on the way back. Secrets and free-form values are not
this variant.

A compiled plugin whose rows are already on the machine uses the load-once adapter
(`registries/commands/localSearch.ts`): no debounce, no minimum query, one fetch when the frame opens
and local filtering after that.

Context-menu rows share the commands' ceiling without sharing their registry. A menu row is a label, an
order, a predicate over what is under the cursor, and one verb from the same closed context-free set a
command takes — so a right-click can do exactly what a command can do and nothing more. They stay a
separate registry (`registries/panes/contextMenus.ts`) because a command is global and a menu row is about
one thing: the row needs a target and a predicate over it, and neither has any meaning in the palette.
Core's own row actions register there too, which is what keeps the contract honest — see
`docs/ui-design.md § Menus and right-click`.

User-configured shortcuts outrank defaults. Among defaults, first-party bindings win, then loaded
plugins in lockfile installation order with plugin id as the stable tiebreak. A losing binding is
unbound and named as a conflict; no fallback chord is invented.

## What the palette refuses

Nine decisions, each with what would reopen it. They are here rather than in a design folder because
every one of them is a thing the palette will keep being asked for.

**A plugin-rendered palette frame.** Refused, permanently. The palette owns global focus, the
reserved keys, navigation, loading, errors and result invocation. An iframe or a remote tree redrawing
those semantics is one palette per plugin, no terminal half at all, and a wider loaded-plugin UI
boundary bought for no domain capability. A plugin returns facts and declares a closed verb; the host
draws them. A genuinely custom workflow is a pane or an overlay, not the palette. An arch rule holds
it: no frame target and no slot id is the palette.

**A second registry for every interactive kind.** Refused. `paletteRows` is the evidence and it is
gone. A group, a search, an input and a setting are variants of a command because shortcuts,
capability gates, ownership, discovery and outcomes are shared, and a parallel vocabulary means
merging, filtering, owning and invoking twice. Reopens if a proposed kind stops having command
semantics at all — a durable background job with no user invocation, say.

**Returning executable commands from a loaded search response.** Refused. A route answer is untrusted
wire input. Letting each result choose a verb, a URL or a route makes a changing server response more
powerful than the manifest somebody reviewed. Results carry display facts and identity; the manifest's
search command owns one static action. Reopens only with a separately designed, schema-bounded
result-action contract, a trust disclosure, and a case one static action cannot express.

**Result action panels.** Deferred, not refused. They are useful — promoting a Rollbar issue, acting
on a container — and they multiply authorization, confirmation, keyboard and untrusted-wire decisions
before the graph and search contracts have proved themselves. A result has one primary action.
Reopens when a concrete secondary action has been asked for by someone using the thing.

**Fleet search by default.** Refused. It multiplies external-provider requests, latency, rate-limit
pressure, result collisions and partial errors. Scope is declared per command and defaults to the
active node; core's task and workspace navigation uses `fleet` deliberately. Reopens if a control
plane provides one indexed fleet query with its own authorization and ranking.

**Calling a model as the reader types.** Refused for ordinary query typing, permanently. Generation is
not search: it costs money, takes materially longer, and produces a side effect the reader meant to
ask for once. Database's `Generate SQL` is an input command, submitted explicitly, with a duplicate
guard and a pending state. A future suggestion system would need an explicit opt-in, a budget and a
cancellation contract.

**Reflecting Settings pages into commands.** Refused. A Settings page is an arbitrary component or a
remote tree, not a field schema; scraping one would couple the palette to rendering and create a
second persistence path. An owner opts a value in by registering a `setting` command whose reader and
writer are the ones its page already calls. Reopens if Settings itself moves to a typed domain schema
every renderer projects — the palette could then be another projection of that same schema.

**Free-form secret settings.** Refused. The `setting` kind is a bounded choice with a visible current
value. Connection keys, HTTP variable values and other secrets need secure input, a reveal policy,
validation and richer recovery than picking from a list. Reopens through a dedicated secret-entry
design, not by widening `setting` to arbitrary text.

**Cross-owner command parenting.** Refused. A plugin inserting children into core's group or another
plugin's creates hidden lifecycle and presentation coupling, and makes ownership unanswerable during a
disable or a reload. Parents and children share one host-stamped owner, and the graph drops a child
that names a parent it does not own. Root descendant search is what keeps a command discoverable
without a cross-owner tree. Reopens with an explicit command extension point owned by the parent,
carrying its own acceptance and ordering contract.

**Replacing every picker with the palette.** Refused as a blanket rule. The editor and GitHub file
finders became commands because each had a named shortcut and one selection outcome. The workspace
topbar picker still uses the generic overlay helper (`host/palette/overlay.ts`), and that is not a
migration anybody owes: the test is semantics, not component resemblance. Reopens per picker, when one
becomes a globally discoverable, context-complete command.

## Pane shortcuts

The shipped pane chords are contribution-owned and tested with the pane registry. Settings →
Shortcuts can override or unbind them. Persisted pane IDs remain stable because they are layout data.

A pane chord is a binding gated on the focused pane, not a layer of its own. What a pane's *layout*
binds is: a `tabs` pane registers Cmd+1 through Cmd+9 — Ctrl+1 through Ctrl+9 on the terminal, where
the emulator keeps Cmd for itself and never delivers it — as a `focus-within` layer on its own
element, which shadows the global task-switching chords while focus is in that pane and hands them
back the moment focus leaves.

## Plugin shortcuts

Loaded plugins declare canonical `meta+ctrl+alt+shift+key` chords against commands from their own
manifest. The host qualifies both ids as `plugin.<plugin-id>.<command-id>`, refuses bare keys and
does not expose `typing-exempt`. A `surface` binding is host-bound to a surface declared by that same
manifest.

Settings → Shortcuts shows plugin bindings under the plugin id and names the active Node because
shortcut preferences are per Node, per user. Disabled-plugin rows remain visible, inert and editable;
plugins absent from the active Node do not appear. Uninstalling never deletes overrides, so reinstalling
restores them. The explicit orphan-cleanup action is the only path that removes settings for plugins
which are no longer installed. Reset operates per section and Unbind persists an explicit `null`.

Binding ids are persistence keys. Plugin authors must keep command ids stable across versions or a
renamed command will no longer find the user's override.

**A pane chord gated on a focused editor**, which is the changes pane's Commit
(`plugins/changes/src/client/commands.ts`). Two things make it work and neither is a key handler:

- The binding is `when: 'pane'`, `pane: 'changes'`, so it is live while the keys are in that pane, and
  `active` is the message field's own focus, because a pane is wider than its editor and Cmd+Enter
  inside the diff column's comment box is that box's business. The field reports focus through the
  kit's `Textarea`, which both hosts answer.
- The chord carries a command modifier, so it reaches the binding even though a text field has focus.
  See [Focus and typing](#focus-and-typing) for that rule and the two other paths that already drew
  the same line.

Registration lives on the pane's model rather than in a region, so the chord's lifetime is the pane's
and not a column's: `list-detail` shows one side at a time below 80 columns, and a shortcut that
disappears when the reader looks at the diff is not a shortcut ([panes.md](./panes.md) § Layout model).

The chord itself was chosen by what was free. `meta+enter` is the `commit` chord in the closed intent
set. Amend is `meta+alt+enter` rather than Zed's `meta+shift+enter`, because core spent that one on
`core.surface.toggle-maximize`, and two bindings on one chord means the loser registers nothing at
all.

Resolution happens before the engine sees anything. `resolveKeybindings` applies the user's
overrides, the first-party-then-lockfile order, and the conflict rule, and hands the engine one
binding per resolved chord. A losing binding arrives with a null chord and registers nothing, which
is why Settings can show it as a conflict while the keyboard behaves as if it were not there.

## Focus and typing

The keyboard is one engine, `@opentui/keymap`, installed on the shell root by
`client-core/host/keys/install.ts`. Its HTML adapter turns DOM keydowns into keymap events and tracks
targets with a `MutationObserver`. The terminal client writes its own `KeymapHost` — all thirteen
members, over its node tree and its region store — and drives the same engine, so it gets the same
layer model, the same `intentKeys` table and the same bubbling
([tui.md](./tui.md) § The adapter). It needs more priorities
than this host does, because it draws the whole workspace in one window and an entered terminal has
to sit above every one of them, and all ten of them are written in one file with a sentence each
(`apps/tui/src/keys/tiers.ts`). What differs is the pair of
type parameters — a target is a node of the terminal client's own tree there and an `HTMLElement`
here — so
`client-core/kit/keys/keymapHost.ts` names neither: the host supplies its pair at `setKeymap`, along
with its own answer to "is somebody typing right now", which is the only question a binding asks
about the focused thing.

**There is no second keymap, and there will not be.** One engine, one command catalog, one adapter per
host. No plugin and no first-party pane installs a key handler of its own outside an input and the
inside of a rectangle. A pane that wants a chord registers a command and a binding, which is how it
reaches Settings → Shortcuts, the palette, and the cheat sheet at once; a handler installed beside the
engine reaches none of them and cannot be rebound, overridden, or shown to the reader in a conflict.

**Keys become intents before a component sees one.** The closed set is in
`client-core/kit/keys/intents.ts`: `next`, `prev`, `first`, `last`, `pageNext`, `pagePrev`, `expand`,
`collapse`, `activate`, `dismiss`, `commit`, `search`, `menu`, `delete`, and the four region and pane
moves. `client-core/kit/keys/keymap.ts` maps this host's keys onto them, and it is the only file that
knows a platform difference: `commit` is Cmd+Enter on macOS and Ctrl+Enter everywhere else, and
nothing else changes between the two. Which of the two a host gets is the host's answer and not the
platform's, because a terminal emulator keeps Cmd for itself and never delivers it — so the terminal
passes `ctrl` to `setKeymap` and every chord in the table, and every chord its shell registers,
is spelled with Ctrl there. A kit node handles intents. A plugin receives `onSelect`,
`onActivate` and the rest, and never a key event, outside `Input`, `Textarea`, `Composer` and the
inside of a rectangle.

An unhandled intent bubbles. A binding whose handler returns `false` is not handled, so the engine
carries on to the next layer: the focused collection answers, or an ancestor does, or the region
layer does, or nothing does.

**A bare key belongs to whoever is typing; a chord does not.** While a text field has focus, a
binding fires only if its chord carries a command modifier — meta, ctrl or alt — because nothing types
Cmd+Enter into a message. That covers the scoped bindings a reader presses in a pane's own field, the
changes pane's Commit among them, and it leaves every bare key with the field. `typing-exempt` keeps
its meaning either way: it is the scope a bare-key binding declares, and a binding that asks to be
exempt from typing gets what it asked for whatever it spells.

Two other paths already drew this line and this host was the one that refused both. The
sandboxed-frame SDK forwards a modified chord out of a frame's own input and keeps a bare one
(`client-core/host/frames/sdk.ts`), and the terminal host's command layer shadows bare keys while a
field has them and lets chords through at every depth
(`apps/tui/src/keys/commandLayer.ts`). Escape is not a chord and is unaffected: an open overlay
answers its own, and the matcher hands it over before any of this.

**Which is why a handler that changed nothing says so.** `onExpand` on a `Rows` may return a boolean:
`false` means the row did not fold — a leaf, or a list with nothing to open — and hands the key back,
so the tier below answers it. On the terminal that tier moves one column, which is how Right on a
file in the editor's tree reaches the document beside the tree. Inside a tab strip's panel the move
stays within the pane: with no column of the pane's own that way, the key reaches the strip and
changes the tab rather than landing in the rail ([tui.md](./tui.md) § The five key groups).
Returning nothing claims the key, the
way the collection always did, so no caller changes until it opts in; the editor's file tree is the
one that has (`plugins/editor/src/client/FileTree.tsx`). The terminal's tab strip keeps the same rule
at its last tab.

**Focus is a property of the tree.** Each kit node has a fixed focus role
(`client-core/kit/tokens/focusRoles.ts`), and a plugin sets none of it: stops, collections with roving
focus, items inside a collection, and the two traps. Every layout region is a focus group. F6 and
Shift+F6 move between the regions of a pane, Ctrl+Option+Right and Ctrl+Option+Left move between
panes, and each group remembers the node focus was last on, so coming back lands where you left.
`client-core/host/keys/focusRegions.ts` holds that, writes `focusedPane`, and emits `runtime:focus-changed`
with the task, pane and region.

The terminal keeps the contract and replaces the mechanism, and
[tui.md](./tui.md) § Keys and focus owns the whole of how: five levels, five key groups, a
shell-installed topology, a dialog as a scope, one landing rule, and eleven invariants with the file
that checks each. Where the keys are is a value that host's region store holds and nothing else
writes, which is what a host with no pointer has instead of `document.activeElement`. Two things there belong to
this table rather than to that one. Tab is `nextRegion` on that host, beside F6, because the browser
owns Tab and a terminal does not, and a reader in one presses it first; the intent is the shared one
and `intentKeys` is still the table, and a host adding a key to an intent it already has is what a
per-host key table is for. And overlays and entered PTYs retain first refusal there as everywhere.

**Collection state is the host's.** A run of `Row`s inside a `Rows`, a tab strip, a menu, a chip row,
a segmented control, a timeline and a grid are all one collection with roving focus inside, and the
arrows, Home, End, `g` and `G`, the page keys and type-ahead come from
`client-core/kit/keys/collectionIntents.ts`
rather than from the pane. `active` and `selected` live in the host's store keyed by the item's own
key ([state-ownership.md](./state-ownership.md)), so a refetch keeps your place.

That file is the rules about a *list*: what wraps, where the first press lands, which of select and
activate picks, what a page key moves by. Each host supplies two things and nothing else — put focus
on an item, and say whether the item itself holds focus rather than a control inside it.
`collection.ts` beside it is the DOM's half: `focus()`, `scrollIntoView`, the `aria-*` attributes and
the roving `tabindex`. `apps/tui/src/keys/collection.ts` is the terminal's, where a row hands its
renderable back as it draws and the caret is drawn wherever focus is. Non-virtual documents use a
`ScrollViewport`, which owns the offset; a virtual `Rows` keeps its own window so wheel input can
move the viewport without changing the active key and keyboard movement can reveal that key again.

`Grid` is the one documented exception, and it is a consequence of virtualisation rather than a
shortcut. Most of its rows have no element, so roving focus cannot be DOM focus: the arrows move a
`selected` index the caller owns and scroll it into view. The intents and the single tab stop are the
same as every other collection's, which is the part the role promises; where the place is kept is not.

`Timeline` is the terminal's own exception, and it drops the tab stop rather than the place. In cells a
turn is a `Card`, and a card is a stop only where it takes an `onPress`, so a conversation's stops are
the controls and composers inside its turns and nothing roves over the turns themselves. The DOM host
is unchanged. [tui.md](./tui.md) § Collections has the whole of it.

`DiffPane` and `KeyValueEditor` are not collections at all, and the focus table says so. A diff is a
scroller of text whose focusable parts — the per-line comment control, the toolbar — are ordinary stops,
and finding a line is the `search` intent rather than a rove. A key-value grid is every cell a stop
already, the same answer `Table` gives.

**Scopes are layers.** The four `KeybindingScope` values map onto the engine's model, and priority is
what decides which one wins, not how local a layer is:

| `KeybindingScope` | Layer | Target | Priority |
| --- | --- | --- | --- |
| `global` | global | the root | 0 |
| `task` | global, gated on an open task | the root | 0 |
| `pane` | global, gated on the focused pane | the root | 0 |
| `typing-exempt` | global, gated off typing targets | the root | 0 |

Scope is a property of one binding rather than of a layer, so all four register together and each
binding carries a matcher that reproduces its scope: an open task for `task`, the focused pane for
`pane`, and off a text field for everything but `global`. The layers that do take an element are the
ones a rectangle of the tree owns: a `tabs` pane's Cmd+1 through Cmd+9 at priority 30, above the
global chord that switches tasks, and a collection's intents at priority 40. Both are `focus-within`,
so they are live only while focus is inside them.

Escape is the exception the engine cannot express. An open overlay answers its own Escape, and
`kit/lib/dismissable.ts` keeps a stack of them so a pile unwinds one press at a time, so an `escape`
binding goes inactive while focus is inside a dialog. Consuming the key in the engine would stop the
DOM event too, and the overlay would never see it.

**In a terminal, an overlay and a rectangle each own the keys outright**, and these are the two places
the terminal's keyboard is not the desktop's. There is no scrim to click through and no window to
click outside of, so a `Modal` or an open `Menu` is a scope: the box goes on the region store's scope
stack while it is drawn, and every question that store answers is answered inside it, so there is
nothing behind the dialog for a key to reach. One layer goes with it, `dismiss` above everything. It
was two, and the second named the intents it swallowed, which is a table that leaks a key the moment
it differs from another one ([tui.md](./tui.md) § Traps). An entered `pty` rectangle takes every
key before dispatch, `Ctrl+C` included, which is the point of entering one. Escape alone leaves a
rectangle; pressing it twice goes back in and sends one through, which is how a reader reaches vim's
normal mode from in there. Being entered is derived rather than remembered: it means the box has the
keys, is on screen, and had an Enter pressed on it since it last lost them, so a rectangle hidden by
a tab switch stops taking keys the moment it goes off screen
([tui.md](./tui.md) § The Rectangle contract).

**The cheat sheet** (`client-core/host/keys/CheatSheet.tsx`, Cmd+/) lists what the keyboard will do right
here, read from the engine's own catalog rather than from the keybinding registry. `getActiveKeys`
answers for the layers that are live against the element that has focus, so a chord a pane shadows
shows the pane's meaning and a chord whose command is unavailable does not appear.

**The terminal's footer is the same list, one line long.** `apps/tui/src/chrome/bindings.ts` reads
`getActiveKeys` too, gives each live intent a word, and the footer prints as many as fit while the
cheat sheet on `?` prints all of them. Nothing is declared twice. Which word a key gets depends on
what has the keys, and [tui.md](./tui.md) § The footer owns that table.

A sandboxed plugin frame has its own document, so its SDK normalizes and forwards unclaimed keydowns
over the existing rate-limited bridge. The host resolves them against the same binding table,
preferring that frame's surface binding before global or task bindings. This keeps shell chords
working while a frame is focused without adding another shell listener.

A frame may keep only the modified chords declared in its manifest `claimsKeys`. Runtime
`acorn.keys.claim()` may narrow that set, never extend it. Claims are visible in Shortcuts and in the
trust prompt. The palette (`meta+k`), settings (`meta+,`), task switching (`meta+1`-`meta+9`) and
`escape` are reserved and cannot be claimed. Bare typing inside a frame remains local.
