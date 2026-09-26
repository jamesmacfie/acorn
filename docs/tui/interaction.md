# Terminal interaction and reporting

Part of [tui.md](../tui.md).

## Keys and focus

[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md) § Focus and typing owns the
intents, the four layer tiers, and the two rules a host with no pointer adds. What follows is the
mechanism.

### The adapter

`apps/tui/src/keys/install.ts` builds the engine from `apps/tui/src/keys/keymapHost.ts`, this
package's own `KeymapHost`, where the DOM host builds `createDefaultHtmlKeymap(root)` from the
package's own adapter. All thirteen of its members are ours, answered over the node tree and the
region store: the tree walk is a node's `parent`, the key stream is an emitter the input parser
pushes onto, and `getFocusedTarget` and `onFocusChange` are the store's one focus value and the
signal behind it. Three are absences rather than stubs — a node is never destroyed, so
`isTargetDestroyed` is false and `onTargetDestroy` never fires, and there is no raw-input pipe to
prepend to because bytes become events before they arrive.

The engine is what stays, and that is the point of the split: it is pure TypeScript, the desktop
drives the same one through `client-core/kit/keys/keymapHost.ts`, and both hosts on one engine is
how the two adapters cannot drift. What a host owns is the thirteen answers, and the one that
matters is where focus comes from (§ Focus regions).

`client-core/kit/keys/keymapHost.ts` holds the engine at the widest type pair the engine allows and
hands each host's pair back at the one call that reads it, rather than being generic over a pair
every caller threads through: every caller in the kit means the DOM's, and forty components would
have gained two type parameters to say nothing new. One host-supplied predicate crosses instead,
"is somebody typing", which is the only question a binding asks about the focused thing.

Chords are spelled with `ctrl` here. The engine reports the platform's primary modifier, which on
macOS is `super`, and a terminal emulator keeps Cmd for itself and never delivers it, so `commit` was
a chord nobody could press. `setKeymap` takes a `primary` and this host passes `ctrl`.

Spelling it `ctrl+return` is half the answer, and `apps/tui/src/input/terminal.ts` asks the terminal
for the other half in its enter sequence, along with the alternate screen, raw mode, SGR mouse
reporting, DEC 1004 focus reporting and bracketed paste. A legacy terminal sends one byte,
`\r`, for Return with Ctrl held and Return without it, so `commit` does not reach the engine as a chord
at all. The `disambiguate` flag of the kitty keyboard protocol is what makes the two distinguishable,
and it settles a lone Escape the same way, which the parser otherwise has to wait out. A terminal that
does not know the request ignores it, and the mode is popped on exit either way. Both test harnesses
ask for the same protocol, because a suite driving a different keyboard from the app is testing a
different keyboard.

### The five key groups

Every key is an intent before it is a key (`client-core/kit/keys/intents.ts`). Where an intent lands
depends on the thing that has the keys, and an intent bubbles: the innermost thing that can answer
does, and a handler returning `false` passes it on.

| Group | Keys | In a collection | On a parent stop | On a plain stop | On a viewport with no stops | Bubbled to the region tier |
| --- | --- | --- | --- | --- | --- | --- |
| Move | `↓` `j` / `↑` `k` | next/previous row, wrapping as `collectionIntents.ts` says | Down enters the panel the strip is showing; Up leaves for the previous stop | next/previous stop in reading order within the panel, revealed in every viewport around it; the bottom edge is a wall and Up from the first stop of a panel is the strip that owns it | scroll a fifth of a page | nothing |
| Cross | `→` `l` / `←` `h` | `expand`/`collapse`, which a tree answers and a horizontal collection moves; a plain list and a leaf bubble | the next/previous tab; an edge bubbles | bubbles | bubbles | one column left or right, landing on that column's last-used region, no wrap; from inside a panel only the pane's own columns count, and with none that way the strip that owns the panel takes it: the tab changes if it can and the keys land on the strip |
| Act | `⏎` `space` | activate the row, then enter main where the region says so | nothing | press: `onPress`, a toggle, a `Select`'s list, an `Input`'s submit, an entered rectangle | nothing | nothing |
| Back | `esc` | the parent stop if a panel holds the collection, else the region's home | the region's home | the parent stop, else the region's home | the region's home | a notification clears, else the climb the shell's topology names |
| Page | `pgup` `pgdn` `home` `end` `g` `G` | `pagePrev`, `pageNext`, `first`, `last` on the collection | scroll the viewport around it | scroll the viewport around it | scroll | nothing |

**`g` and `G` are `first` and `last`, and they are not this host's own.** They sit in `intentKeys`
beside Home and End, so a desktop list answers them too, and the terminal adds no key for either. A
sequence would be the vim spelling — `g g` for the top — and we refuse it: `g` already means `first`
on its own, so making it a prefix would put a timeout in front of a key that answers instantly today,
and the footer has no way to draw "g then g" in a cell. Nothing else on either host wants a sequence,
and the engine's support for them costs nothing while nothing uses it.

**A cross key has one meaning per level and one at the bottom.** A handler that changed nothing
returns `false`, so the key carries on down: a tab strip at its last tab, a tree row that is a file,
a plain list with no fold. What waits at the region tier is the column move, and it is the only thing
`h` and `l` mean there — so Left with nothing to the left goes one column left in every control on
the screen. That is a reversal: a tab-strip edge used to be a wall, on the grounds that a failed Left
threw the reader back into the rail unexpectedly. The surprise was smaller than the inconsistency,
which was one key with five meanings and two of them silent. The footer says `column` where that is
what the key will do, so the reader is told before they press it.

**A panel is a level, and a bubbled cross key does not skip it.** The strip's Left and Right are
bound to the strip by focus, so a key bubbling up from a control inside one of its panels used to
pass the strip and land on the screen's column move — which from any button or row on a tabbed pane
put the reader in the rail. `crossParent` in `apps/tui/src/keys/regions.ts` is the missing level, and
the region tier asks it before it moves a column. Inside a panel the pane's own columns still count,
because Right on a file in the editor's tree is how the document beside the tree is reached; the rail
does not, because Escape is the way out of a pane and a control's Left is not. With no column that
way the strip that owns the panel takes the key: it changes its tab if it can, and the keys land on
the strip either way, because after a switch the panel that had them is hidden, and at the strip's
edge a visible move to the strip beats a silent wall — the next press is the strip's own. The footer
says `column` inside a panel while the pane has a second column and `tab` where the strip is the
answer. Up has the matching rule: the first stop of a panel is entered from the strip with Down, so
Up from that stop is the strip, and only the bottom edge of a panel is a wall. A dialog drawn inside a
panel is out of the panel's scope, so neither rule reaches the tab behind it.

Tab and Shift+Tab cycle every region on screen in declared order and wrap, and the pane chords cross
the column edge before they switch the pane. Both are in § Navigation. Neither bubbles, and Tab has
one exception, below.

A `MentionTextarea` sends on a bare `⏎`, and `⇧⏎` is the newline. That is what the shared prop has
always said the node does — `onSubmit` is documented as "Enter without a modifier. Absent leaves Enter
as a newline" — and the DOM half reads exactly that; this host had it on the `commit` chord alone, so
the agents composer's own hint said `Shift+Enter for newline` and described a keyboard nobody had. An
open suggestion list takes the key first and completes, as it does on the desktop. On a terminal that
ignores the kitty keyboard protocol there is one byte for both, so `⇧⏎` sends too and a newline has to
be pasted; that is the same terminal on which `ctrl+⏎` never arrived either.

`ctrl+⏎` is `commit` and submits the `Composer` or `Input` that has the keys. It is typing-exempt, so
it fires from inside the text, and a `Composer`'s submit button is a plain stop that Tab reaches, for
a reader who does not know the chord.

While an `Input` or `Textarea` has the keys, bare keys type. The move, cross and page groups go inert
except `↑` and `↓` inside a multi-line `Textarea`, which move the cursor. Escape leaves the field for
its parent stop or the region's home, which is how a reader gets out of a composer without sending.
Tab, Shift+Tab, `ctrl+⏎` and the pane chords all work from inside a field.

**Tab in a field is the next control before it is the next region.** The arrows type there, so a
field was the end of its panel's walk: on the pull request pane, the `[Comment]` button beside the
comment box, the review box under it and its three verbs could not be reached from the keyboard at
all — Escape went back to the tab strip and Down came back to the same box. So a field binds Tab and
Shift+Tab to the stop walk at its own tier, above the typing shadow, and says whether it moved; at
the panel's edge it declines and the region tier's Tab answers as it always did
(`apps/tui/src/kit/asking.tsx` § step). The footer says `tab next` in a field and `tab region`
everywhere else. This is the DOM's own rule — Tab is the next control in a form — and it is lazygit's
inside its commit box, where Tab toggles the summary and the description and Escape closes. gh-dash
needs no such key because its comment box is a mode entered with `c` rather than a stop in the
reading order, and that shape is still open to us if a field ever wants more keys than a panel can
spare (§ Doors left open).

**An arrow at a field's edge leaves the field.** A multi-line field answers Up and Down by moving the
caret a row and says so; where there is no row to move to it declines, and the hand-off below walks
the stops instead. Without that the hand-off swallowed the key either way, and a field was a wall: the
agents pane's message box sits between a transcript and an action bar, so with the keys in it the
header above could not be reached at all. Down at the last line leaves the same way, which is the
shape every editor with a form under it has.

**Typing is a layer, not a matcher.** That paragraph used to be said once per binding, as
`active: () => !isTyping()` on every bare key of every control on screen. It is said once now, by a
layer at the `TYPING` tier that binds the bare keys while a field has them and is unregistered when it
loses them (`apps/tui/src/keys/install.ts` § The typing shadow, `apps/tui/src/keys/tiers.ts`). Its
bindings claim the key so that nothing below the tier answers, and carry `preventDefault: false` so
the key still reaches the field and is typed. That is the same shape as a `Modal`'s key claim — a
scope, not a swallow (§ Traps) — with one difference: a scope is pushed by the box that is drawn, and
the shadow follows the region store's focus signal, because "is the focused thing a field" is a fact
about focus and the store is the only truth about that (§ Focus regions).

The key still has to reach the field, and the dispatcher hands it over rather than leaving it to
anything under the dispatcher. `apps/tui/src/keys/install.ts` § typeInto is one ordinary listener
after the engine's: where no binding claimed the key and the store's focused node is a field, it
calls that node's own `handleKeyPress` and then claims the key. A field installs `handleKeyPress` on
its node from its own `ref` (`apps/tui/src/kit/asking.tsx`), and the edit model behind it reads the
key and nothing else — no focus of its own to check, which is what makes the hand-off possible at
all.

The reason it is a layer is a number. `@opentui/keymap` 0.5.9 caches the answer to "what is live right
now" only while no registered layer, command or binding carries a runtime matcher, and the counter is
global, so one such binding turned the cache off for the whole process — and the footer asks that
question on every render (§ The footer). On a browse screen 48 bindings carried the matcher during
ordinary navigation; the count is zero now. The command layer follows the same rule for the same
reason: its bindings are filtered where they are built rather than gated where they fire
(`apps/tui/src/keys/commandLayer.ts`).

The tier is the whole of the design and it sits between the collection's 40 and a stop's 42.
Everything at or below it is a layer that reaches a focused field from somewhere else — the collection
around it, a viewport's page keys, the screen's own column moves, the command layer's bare keys — and
each has to go quiet while somebody types. The two tiers above it are bound to an exact renderable by
focus, and a field is never the renderable they are bound to, with two deliberate exceptions that want
their key while somebody types: the suggestions list under a `MentionTextarea` and the Down and Escape
that leave a descriptor source's filter field. A `MenuList` wants the same thing and cannot have it at
its own tier, because its arrows sit *below* the collection on purpose, so it registers a second pair
above the shadow while a field inside it has the keys — a layer that comes and goes, like the shadow
itself.

### Focus regions

`apps/tui/src/keys/regions.ts` keeps the DOM host's contract and replaces every mechanism in it. It
describes five levels and nothing else:

```text
Screen
└─ Column           0 the rail, 1 the pane, 2 a second frame        right/left cross, no wrap
   └─ Region        Menu, Browse, Tasks, the pane strip, a layout's own regions   Tab cycles them
      └─ Parent stop   a strip that owns panels                    Down enters, Escape returns
         └─ Stop    a row, a control, a viewport holding no other stop
```

A region is registered by its layout with its id and its order, from the layout's own knowledge of
its regions rather than from `compareDocumentPosition`. **Focus is a value the store holds, and
nothing else has an opinion about it.** One signal says which renderable has the keys, one function
writes it — which region that puts them in and what the region should remember are written in the
same place — and everything that moves the keys goes through `focusRenderable`, which decides and
reports whether they went. Nothing under the store holds focus of its own: a node's `focus` and
`blur` are no-ops kept as a one-way mirror in `paintCaret`, and `apps/tui/src/invariants.test.ts`
counts the calls — one `focus`, one `blur`, both in that mirror, and no source file outside a test
asks anything but the store where the keys are. That is worth a rule rather than a habit. A second
owner of focus is a lit border with dead arrows every time the two disagree, and the disagreement is
invisible: the renderable is drawn as focused and the layer bound to it never fires.

The caret is drawn from the same value. A field asks the store whether it has the keys and writes the
answer into its own props, where paint reads it, so there is no focus state anywhere for the store to
be out of step with.

The mouse is a hit test rather than a focus event. The renderer resolves which renderable a left click
landed on and bubbles it up to the root; the store walks up from there to the nearest thing that could
hold the keys and focuses that through its own door, and a click with nothing focusable above it moves
nothing. `autoFocus` is off wherever a renderer is built — `apps/tui/src/main.tsx` and both test
harnesses — because with it on the renderer walks up from the same click and focuses the first
focusable ancestor itself, which is a second opinion about focus for exactly the case one owner is
for.

Entering a region lands on a stop that asked for it, else its first parent stop, else its first
collection row, else its first stop, else the region's own frame, walking the node tree depth first.
The first of those is `markEntry` and the agents composer is its only caller: a chat surface is one a
reader arrives at to write, so the message box takes the keys and the transcript above it is a walk
away. Nothing else may ask — the rule the rest of the list encodes is "the thing the bare keys drive",
which is why landing in a filter box is refused: `j` there types a `j`. The middle step is this
host's own: on the desktop a reader arrives with a pointer and clicks what they meant, and here the
first thing focused is the thing the bare keys drive, so landing in a filter box would mean `j` types
a `j`. A landing on the frame is never remembered — the list that arrives a moment later is what the
next walk into the region finds. Without that rule a reader who looked into Browse before choosing a
source came back to a lit border, no caret, and arrows that did nothing, for the rest of the run.

**A strip with panels is a parent stop.** `markParent(node, panels, cross)` marks one, where `panels()`
returns the boxes whose subtrees it owns and `cross` is how it answers Left and Right. From outside it
is one stop: `left`/`h` and `right`/`l` walk it without wrapping and an edge bubbles to the column
move, `down`/`j` enters the panel it is showing, `up`/`k` is the previous stop beside the strip rather
than one of the strip's own tabs, and Escape from anything inside that panel returns to it. From
inside the panel, Up on its first stop returns to the strip, and a bubbled Left or Right with no
column of the pane's own that way is handed to the strip's `cross` and lands on the strip (§ The five
key groups). A strip that owns
none, such as GitHub's Open/Closed pull filter, is an ordinary control, so Browse still opens on its
rows and Up/Down reaches the collection. The strip is a sibling of its panels rather than an ancestor,
so walking up from a control never reaches it: the panel box is what the walk reaches, and the panels
list is the edge that carries the rest of the way.

Which panels a strip owns is drawn rather than passed. A `TabPanel` registers its own box under the
`idPrefix` it already carries and a `Tabs` reads the set under the same prefix, so a plugin that draws
the two halves in sibling components gets the behaviour without knowing about any of this — which is
how Linear's issue view, Rollbar's item view, Docker's two strips, the HTTP panes and the editor's
side strip all came to have it. `idPrefix` is the pairing because the DOM kit already requires it on
both nodes to build the `aria-controls` ids, so it is a relation the kit promises rather than one this
host invented. The `tabs` layout frames its panel with `Panel` instead of a `TabPanel` and registers
it under its own `stateKey`. `DocumentTabs` is not a parent: the document an editor tab opens is the
layout's region below the strip, not a panel the strip owns, so it is a horizontal collection —
`←`/`→` open the next document, Enter re-opens the current one, Delete closes it.

**Arrows move between stops.** `down`/`j` and `up`/`k` on a control go to the next stop beside it in
reading order and reveal it in every viewport around it. The neighbours are the stops of the panel the
control is in, or of its region where no panel owns it, and an edge is a wall: an arrow never crosses
a region, because Tab already does that and a strip that did it surprised readers. `stopsIn` is the
walk, depth first over the retained tree, and each of its rules is a level of the model showing
through. A parent stop counts once and its panels are skipped, since a panel is the level below and
Down is the way in. A collection counts once, drawn as the row its caret is on. A scroll viewport is
transparent while it holds a stop and is the stop itself otherwise. Anything else focusable counts
once. `moveStop` answers false for whatever the walk does not own, which is how a row hands the arrows
back to its collection and a document with no controls keeps them for scrolling.

**The store is indexed, and the lists it keeps are for ordering.** Every question here is asked inside
a walk of the retained tree: `stopsIn` asks of each child whether it is a region, a parent stop, a
collection or somebody's panel, and `regionOf`, `parentOf` and `boxAround` ask the same of each
ancestor. Each of those was a scan of a module-level array, and `isPanel` was a scan that allocated a
panel list per parent per question, so a key press cost the number of renderables in the region times
the number of regions on screen. They are a `Map` from box to region, a `Map` from node to parent stop,
a `Map` from box to collection, and one `Set` of every panel on screen; the arrays stay, because
ordering is what they are good at, and `ordered()` — the region cycle — caches its sorted answer until
a region registers or a scope moves. The panel set is derived from the same `panels()` getters
`parentOf` reads rather than written beside them, so there is still one answer to "is this a panel"
(`apps/tui/src/keys/regions.ts`, `apps/tui/src/kit/grouping.tsx` § registerPanel). A move asks
`stopsIn` once and hands the list to the walk, where it used to ask twice.

**One deferred decision.** A focus decision that needs a renderable the current render has not
produced yet waits in `ensureFocus`, queued at most once per turn by `scheduleSettle`. A microtask
rather than a frame event, because a test renderer under `flush()` may render several times before a
frame, while Solid commits synchronously and every renderable of the current render exists at the end
of the current task. `apps/tui/src/invariants.test.ts` holds the folder to one `queueMicrotask` and
the kit to none.

A tree to read is the whole of what the microtask buys, and there is nothing left for it to be
ordered against. A node is never destroyed, so the pass's only question about the node it holds is
whether that node is still in the tree and still on screen, which is a walk up the parents at the
moment it asks. A scope popping takes the keys out of the box that is going rather than waiting to be
told.

**One question.** Can the renderable that has the keys still hold them, and is it the real thing
rather than a stand-in? Holding them means alive, visible, visible all the way up to the root, still
`focusable`, and inside the top scope. The walk up the parents is the half that matters, because
`visible` is per node: the shell hides the main row behind an overlay and a `TabPanel`
hides the tab that is not showing, and a focused descendant of either goes on saying it is visible. A
stand-in is a region's own frame while that region has an entry stop, or a collection's container
while that collection has a live active row. Both are `focusable` so that they can hold the keys when
nothing else can, and both stop being the right answer the moment their contents arrive. If the
answer to the question is yes, the pass reveals the stop in the viewports around it and stops.

**Four steps if the answer is no.** A scope holding the keys takes the stop it last had, then the
first stop inside its box, then the box itself, which is `focusable` from the push. On the screen the
same four steps run with a region in front of them: the region that still claims the keys, else the
region the shell opens on, else the first one drawn; and inside whichever of those answers, the stop
it last had, its entry stop, its frame, which is `focusable` from registration. A remembered stop
resolves by collection identity first, because a query refresh redraws the same logical row as a new
renderable, and a stand-in is never restored.

An entry stop that is a list is its **roving row**, not its first row. A region remembers a
renderable, and a renderable does not survive its list being rebuilt from a different roster — the
collection's own `active` is keyed and does survive, so this is where the two meet. It matters most
where entering also picks: the rail's Menu is entered with `pickOnEnter`, so landing on the first row
is not a caret moving, it is a source being chosen, and a workspace you return to would lose the
source you left it on. A virtual list whose active row is off its drawn window falls back to the first
row, the same allowance `stopsIn` makes.

**Hiding a subtree asks for a pass.** Two boxes here hide what is inside them rather than unmounting
it, so that the rail and the pane behind an overlay keep their queries and their models and a tab
that is not showing keeps its state: the shell's main row, and the `ScrollViewport` that a `TabPanel`
is. Hiding raises nothing anybody can hear and `visible` is per node, so each schedules a landing
pass when its flag goes false and the pass does the rest, since it already walks the parents before
it decides who can still hold the keys. Without that the keys stayed on a node behind the
overlay: invariant 6 was false of a hidden subtree, and an entered rectangle on a tab that had been
switched went on eating every key in the app.

**A region and a scope each remember their own stops, and one focus move writes one memory.** A
`Modal` or an open `Menu` is drawn inside whichever region held the keys. A region that also
remembered the dialog's rows would hand the keys back to a destroyed row when the dialog closed
instead of to the trigger that opened it, and its claim would say the reader had changed region while
they were answering a dialog. So handing the keys back needs nothing recorded when a scope opens: the
scope remembers where they were inside it, the region behind it still remembers its own last stop,
and closing a `Select` drawn inside a `Modal` comes back to that `Select`.

**The shell installs what the keys cannot know.** `setTopology` takes three answers and
`setPaneCycler` takes a fourth, both from `chrome/Shell.tsx`: where Escape goes from the top of a
region, which region takes the keys when the screen first has any, which regions a first crossing into
a column passes over, and what "the next pane" means when only one is drawn. No chrome id is spelled in
the keys module. It used to find Browse by comparing its id to a string, and the pane strip by
comparing another, which is how a module whose own header forbids reaching into the shell came to
depend on it anyway.

The region cycle is the whole screen rather than the focused pane: the registered rail panels, the
pane strip while a task makes it visible, the pane's own regions, and back. Browse keeps its frame for
layout stability when a component-only source is selected, but registers no region without a list;
neither it nor the absent strip becomes an empty Tab stop. The desktop draws several panes side by
side and Tab into the next one would surprise; there is no next one here. The chrome orders itself
around the pane by declaring orders outside the range a layout uses. `nextPane` first honours the
rail/main edge in its direction; once focus is already in main and there is no further column, it
switches which task pane is drawn.

Regions also declare a column, as an integer counted left to right. Menu, Browse and Tasks pass 0;
the pane strip and every layout or source region default to 1; a layout that draws two frames side by
side declares the second one 2, which `list-detail` does for its detail and
`frame-beside-document` for its frame. A bubbled `expand` (`right`/`l`) moves to the nearest column
to the right and a bubbled `collapse` (`left`/`h`) to the nearest on the left, restoring the last
group used there and never wrapping. Left in the rail and Right from the rightmost column do nothing,
deliberately: a key that jumps across the whole screen from an edge is a surprise, and Tab already
cycles. One rule therefore crosses the rail-to-pane edge and the list-to-detail edge alike. It was a
pair, `rail | main`, and a pair could not say that two frames inside one pane are two columns: every
region a layout registered was `main`, so Right in a `list-detail` pane had nothing to cross to and
did nothing at all. A first crossing into the pane's
column passes over the pane strip and enters the pane itself, because the strip is a line above the
pane rather than a place to work. Collections and layouts keep first refusal: a tree that can expand,
or a narrow `list-detail` that can switch groups, consumes the intent before the region tier. Escape
from a source detail returns specifically to Browse, and from a task pane to the pane strip, because
the shell says so rather than because something remembers the last rail panel visited. Spatial
movement is disabled while an input owns the keys.

### Collections

The intent half of `collection.ts` is shared. The element half has a DOM file and
`apps/tui/src/keys/collection.ts`, where "focus the active item" is a call to the store's own
`focusRenderable`. A virtual
`Rows` owns the visible window: keyboard movement reveals the active key by the smallest amount, and
wheel movement changes the window without changing that key. `Grid` keeps its documented exception:
a virtualised row has no renderable, so the arrows move `selected` and the view follows.

`Timeline` is the exception that goes the other way. `focusRoles.ts` calls it a collection and the DOM
host roves over its turns; here a turn is a `Card`, and a card is a stop only where it takes an
`onPress`. So the stops in a pull request's conversation are the controls and composers inside the
turns rather than the turns themselves, and nothing roves. A reader moves through them with the arrows
and reads the text between with the page keys, which is what every other document here does.

**Moving the caret selects.** Every `Rows` on this host passes `selectOnMove`, which
`collectionIntents.ts` already had and only `Tabs` and `Select` used. It is this host's own answer and
the same kind of departure as opening a region on its list: with no pointer the caret is the selection,
and a reader arrowing down a list of pull requests is asking to see them.

Only `onSelect` fires on a move. `onActivate` still waits for Enter, so showing something is immediate
and opening it stays deliberate, which is the split `pick` and activate already draw. A list that
supplies no `onSelect` — the task list is one — gets nothing new. Arriving on a row is ordinarily not
a move. Menu and Browse opt into one narrow exception at their region boundaries: entering either
runs the collection's ordinary `goTo` for the row it lands on, including when that row arrives after a
query. Menu waits until the provider and workspace-link gates have both answered, then highlights and
shows the first available source together. Its collection place is scoped by workspace, and a
workspace switch clears the old view before publishing the new roster, so the first visit cannot
inherit a detached or non-first row. Browse highlights and shows its first item. Re-entering a
remembered row is idempotent.

### Scrolling viewports

Anything that can outgrow its box is a viewport. `overflow="scroll"` is not one: it is a yoga
clipping instruction, so it hides what will not fit and owns no offset for anything to move. It looks
like a scroll right up to the moment the caret walks below the fold and nothing follows it, which is
what eight of the nine plugin lists used to do. A region body that can grow past its frame is a
`ScrollViewport` or a `Rows virtual`, and `apps/tui/src/kit/scrolling.tsx` is the one file under
`apps/tui/src` allowed to spell the clip. `apps/tui/src/invariants.test.ts` greps for that, because a
clip reviews well.

`apps/tui/src/kit/scrolling.tsx` is the non-virtual viewport seam, and the component owns the
scrolling: the vertical offset, the visible scrollbar, wheel and trackpad acceleration, and the
clamp are all in that file, and the node carries the offset as a prop that paint translates its
children by. The `Viewport` type it exports is what the rest of the app asks of a viewport — the key
tables, the store's reveal and `DiffPane` reach one through that shape rather than through whatever
drew it. Panels opt into it for document/detail bodies; hidden tab panels keep their own offsets.
The viewport itself is the fallback focus stop for a document with no controls. When it contains a
row, textarea, rectangle or other real stop, it is transparent to focus and a focused child is
revealed through every scrollbox ancestor with `scrollChildIntoView`.

A viewport whose `visible` flag goes false asks for a landing pass, because a `TabPanel` is this node
and hiding a panel raises nothing anybody can hear (§ Focus regions).

**A region that clips beats a region that scrolls, wherever the pane has something pinned.** The
`list-detail` detail column clips, and what is inside it scrolls. That is the DOM's rule for the same
region — `.layout-region-detail` is `overflow: hidden` and the pane's own timeline, diff or rows is
the scroller (`client-core/infra/styles/shell.css`) — and this host deviated from it by wrapping the
whole region in one viewport. The deviation cost the agents pane its composer: the message box is the
column's last child, so it scrolled away with the transcript and every turn ended with the reader
hunting for it. Both panes that use the layout own their scroll, the transcript through
`Timeline follow` and the diff through `DiffPane`.

A clipping region puts a line between its children, which is `row-gap: var(--gap-stack)` on the
desktop's own detail region. Stacked straight onto each other, a pane's parts read as one pile: the
agents pane's detail column is a transcript, a row of provider pickers, an expand toggle and a message
box, and the reader could not see where one ended. The other half of that separation is the field's
own frame — `Textarea` draws one, which is what its row in [ui-design.md](../ui-design.md) has always
said it does, and it lights in the accent tone while the keys are inside it.

**`Timeline follow` is a scroller that stays on its last turn.** It holds the offset at the foot while
the reader is already there, and lets go the moment they scroll up to read history, which is decided
in `place()` — the one door the offset changes through, so "is the reader at the foot" cannot drift
from the offset itself. The growth it reacts to is the height of a box sized by the turns, not of the
box that grows to fill the region: the second changes whenever anything else in the column does, and
following that would drag the view to the foot every time a menu opened.

What it does not do is put the reader back on the turn they left. The DOM host holds a reading place as
a turn and an offset into it, handed to it through `place` and `onChange`
([ui-design.md](../ui-design.md) § Behaviour a pane keeps redoing); this host drops both, and
`Timeline.Turn` ignores its `key`. A viewport here knows its own offset and the height of the box
inside it, and finding a turn needs per-turn geometry it does not publish. So `NODE_SUPPORT` calls the
node `reduced` and says what is lost: a list drawn again opens at the newest turn. The offset a mounted
viewport already holds is unaffected, so scrolling up to read and staying there still works.

The nesting question is what decides the shape. A viewport's height comes from `flexBasis: 0` on a
flex line, and the content box inside one is free-sized, so a viewport nested in a viewport has
nothing to be bounded by — the same reason a scrollbox around a whole pane is refused
(§ What the TUI never does). One scroller per column, and the pane says which node it is.

A page key clamps rather than wrapping. `pageNext` goes to the last row and `pagePrev` to the first,
and each hands the key back once the caret is already there, so the viewport below the collection
scrolls instead. This is in the shared `collectionIntents.ts`, so the desktop keeps the same rule:
PageDown on the last row of a list stops. The arrows still wrap, because a list you cannot fall off
the end of is a list you never have to look at.

The reveal runs once, on the renderer's `frame` event, from the one renderer listener
`apps/tui/src/keys/regions.ts` installs beside its click hit test. It waits because
`scrollChildIntoView` compares a child's laid-out `y` against its viewport's, and a node's rectangle
is whatever the last layout pass left there: for a row that did not exist in the previous frame a
reveal taken at the moment focus moved reads stale or zero geometry, scrolls by the wrong delta, and
nothing corrects it. A reader meets that three ways and all three are common — a region entered on a
freshly mounted list, a refetch replacing a row by identity, and a virtual window shift. A frame here
is layout and then paint in one function, so the geometry the reveal reads is the geometry the reader
is about to see. It is not a landing rule and decides nothing about where the keys go; it only makes
the viewport show where they already are, and
`apps/tui/src/kit/scrolling.test.tsx § reveals the caret in a list that has only just mounted` is
what pins it.

One listener for the whole store rather than one per viewport. A pull request draws enough viewports
that one listener each is a crowd, and they would all be doing the work this does once.

Arrows move and page keys scroll, which is the one sentence the footer has to be able to say
everywhere. Arrow keys and `j`/`k` scroll a viewport only while the viewport itself has the keys, and
it has them only where the document holds no other stop. `pgup`, `pgdn`, Home and End scroll it from
anywhere inside it, so a reader on a control halfway down a long panel can see the rest of the panel
without giving up their place. A collection inside the viewport answers those four first, so Home in a
list still goes to its first row. A long description with a copy button at the top is therefore read
with the page keys and the wheel: `↓` lands on the button and stops there, because the text between
two stops is not a place the keys can be.

The diff pane is the third shape, and it is a viewport with a window inside it. `DiffPane` in
`apps/tui/src/kit/showing.tsx` used to build one `<text>` per line of every file, which for a
five-thousand-line patch is five thousand renderables in a pane that shows twenty. It draws from the
same diff document the DOM viewer does ([diff rendering](../diff-rendering.md) § The document): a
file's header is one line and each segment is as many lines as its descriptor says, so the slice
around the viewport's offset is found without any row existing, and only the segments that slice
reaches are asked for, once each. A line whose segment has not arrived reads `loading…`. A box above
and below stands in for the rest. The spacers are
what keep it a `ScrollViewport`: the scrollbox still owns the offset, the bar, the wheel and the
page keys, and it is still the focus stop a document with no controls needs. The offset reaches the
window two ways, because the viewport raises an event for one of them and not the other: its own key
handlers call an `onScroll` the pane passes in, and the wheel is caught on a box *around* the
viewport, because a wheel step runs each node's own handler from the node under the pointer upwards
— so a listener above the viewport sees the scroll after the viewport has already moved its offset,
and one on the viewport itself would see it before (`apps/tui/src/tree/hit.ts`). The known ceiling
is that a spacer is one line per row and an annotated row draws two, so the content is as many lines
taller than the model as there are marked rows inside the window.

Virtual `Rows` deliberately do not sit inside that mechanism: they render only their visible slice,
so there is no offscreen child for a scroll viewport to move. Their own `top` offset handles wheel
input and draws the custom thumb. A wheel can move the active row offscreen without changing
selection; the collection container temporarily keeps the keys, and the next keyboard move reveals
and restores the active row. This division keeps document scrolling native without replacing the
large-list virtualizer or putting a free-sized scrollbox around an entire pane.

### Traps

A trap is a scope, not a swallow. `apps/tui/src/keys/regions.ts` keeps a stack of them. The bottom
is the screen, which contains everything, and a `Modal` or an open `MenuList` pushes its own box
while it is drawn. Every question the store answers is answered inside the top scope and nowhere
else: which regions are on screen, which stops a walk can see, where Tab goes, where Left goes.
Nothing behind the top scope exists as far as the keys are concerned, so a key that has nothing to
reach does nothing. A stack rather than one box, because a `Menu` inside a `Modal` is a second scope
over the first and closing it must leave the modal still holding the keys.

That leaves `keys/trap.ts` with one layer, for `dismiss` at tier 60. It is global rather than bound
to the overlay's box, because a layer with a target only fires when focus is inside it and Escape has
to close the dialog from anywhere. The palette's own arrows sit one number above it, since a palette
is a text box steered with the arrows and the bare keys are inert while somebody is typing.

**A swallow cannot work.** The layer this replaced bound every intent but `dismiss` to a handler that
returned true, and that means naming every key it swallows. The moment its table differs from the
table something else binds, the difference is a key that leaks. That is exactly what happened:
`trap.ts` read the shared `keysFor()`, where `nextRegion` is `f6` alone, while `keys/install.ts`
binds `hostKeysFor()`, which adds `tab` for this host. So Tab was swallowed nowhere, walked the keys
onto a rail row behind the plugin trust prompt, and the swallow then ate everything but Escape. The
one key the footer advertised was the one that broke the dialog. A scope names nothing and has
nothing to leak.

Two more things follow from the rule. The command layer's bare keys, `w`, `p`, `;`, `n`, `q` and `?`,
fire only at the screen's own depth, so a reader who presses one inside a dialog does not get a
picker over the top of it. Chords stay live at every depth. And the footer has to ask the store
rather than the engine, because the region layer's Tab is still registered inside a dialog and the
engine still reports it live, so `activeHints()` shows the `tab region` hint only while more than one
region is in scope.

**Taking the keys is the other half, and pushing the scope is both.** `Modal` calls `pushScope`
from its own box's `ref` and pops it in `onCleanup`, so a dialog contains the keys, lands them on its
first stop by being drawn, and gives them back to the renderable that had them when it closes.
Landing them used to be the caller's job, and the six callers in `apps/tui` all remembered. The
helper was this app's, though, and a plugin only has the kit, so every modal a plugin drew trapped
the keys and left them where they were. A dialog that swallows what the reader presses and never
receives it is worse than one that does not open.

### The Rectangle contract

A rectangle is one tab stop from outside. Enter hands the keys to what is inside, Escape takes them
back. A `pty` rectangle owns its keys by intercepting rather than by holding a layer, because a layer
answers keys it can name and a rectangle answers all of them: `PtyRectangle` registers an intercept
above every layer and consumes what it takes. Keys reach the emulator through `encodeKey`
(`apps/tui/src/kit/ptyKeys.ts`), which is the whole of its keyboard: headless xterm parses bytes and
draws cells and has none of its own.

**Being entered is a fact about the screen, not a flag anybody keeps.** A rectangle is entered while
the reader has pressed Enter since the box last lost the keys, the box has the keys now, and the box
is on screen all the way up to the root. The intercept asks all three of those at the moment a key
arrives, so there is nothing to go stale. The one thing stored is the Enter, and the store's own focus
signal clears it: something else taking the keys and the box going off screen are two different ways
to lose them, they used to raise a renderer event and nothing respectively, and one signal is both.

It has to be a question rather than a flag because `visible` is per node: hiding an ancestor leaves
the rectangle's own box reporting itself visible, and both of this app's ways of hiding a subtree do
exactly that — the shell's main row behind an overlay, and a `TabPanel` that is not showing — so a
flag left a rectangle nobody could see consuming every key in the app, `Ctrl+C` included, because the
intercept sits above every layer there is.

The footer asks that same question of every rectangle that is mounted rather than counting the ones
that are entered. Two can be mounted at once, a task with a terminal pane beside a docker exec, and
a count was the thing that could disagree with the screen: the second one leaving decremented a
number the first one still held, and a hidden one never decremented at all.

Escape alone leaves. A second Escape within 400 milliseconds goes back in and sends one. There is no
pending window on the first press, because holding it to see whether a second arrives would put a
delay on every exit, and this is already the one key rule the desktop does not have. Leaving moves
the keys through `focusRenderable` like every other move, so the region the rectangle sits in sees
them come back to its door.

### The footer

The footer lists the intents the focused thing accepts with their primary keys, read off the keymap's
active layers. Nothing is declared twice. `activeHints()` reads the signals that move them: where the
keys are, whether an overlay has taken them, how many regions are in scope, whether somebody is typing,
and the engine's own `state` event, which fires when focus moves and when a layer is registered or
unregistered. Without those the footer is whatever was true at the render that happened to build it.

The list is cached against exactly those five, because the footer draws whenever anything on the screen
does — a terminal frame, a toast, a task list arriving — and building it walks every active layer. A
keyboard-free redraw costs nothing now, where it used to cost two full collects. Two, because the plain
list and the descriptions were separate calls; `includeMetadata` enriches the same keys rather than
choosing different ones, so it is one call.

The words come from a table in `bindings.ts` with one row per kind of focused thing, because the same
key promises different things in different places and a reader on a Merge button should not be told
Enter opens something. `focusedKind()` asks the region store which kind has the keys, in this order:

| What has the keys | `j`/`k` | `enter` | `h`/`l` | `ctrl+enter` |
| --- | --- | --- | --- | --- |
| A field, meaning an `Input` or a `Textarea` | move | press | type | send |
| A row of a collection | move | open | fold, or column | commit |
| A parent stop, meaning a strip showing a panel | `j` enter | press | tab | commit |
| A stop that opens a list, meaning a `Menu` trigger and so every `Select` | move | open | tab, or column | commit |
| A viewport holding no other stop | scroll | press | tab, or column | commit |
| Any other stop | move | press | tab, column, or move | commit |

A `Menu` says which it is by passing `opens` to `pressable`, and nothing else in the kit does yet. The
order is a priority: a field is a stop too, and a viewport is only ever a stop while it holds none.

The `h`/`l` column is the one the kind alone does not settle, so `words()` resolves it from three
questions the store answers. A collection that was given an `onExpand` folds and says `fold`. A stop
that answers `expand` and `collapse` itself is a horizontal collection drawn as one stop —
`DocumentTabs`, `SegmentedControl`, a chip row — and says `move`, because the pair moves inside it and
never reaches the column. Anything else says `column` where there is a column the pair can reach —
which inside a panel leaves out the rail — and `tab` inside a panel with none, because the strip that
owns the panel is what answers there (§ The five key groups). The footer said `fold` for every kind
before that, which was true of one of them. A field's bare keys
type, so their layers are inactive and the engine never reports them live; the words in that row are
there for the table's sake and the footer draws the chord alone.

While a PTY is entered the footer says `esc leave · esc esc send escape`. `?` opens the cheat sheet as
a modal with the same hints and a sentence each, and the footer itself is not a focus stop: it is a
label with nothing to drive, and a stop that does nothing is a hole a reader falls into.

**The cheat sheet is the footer's own list, drawn in full.** It calls `activeHints()` and nothing
else, so a binding that appears in one appears in the other and a key nothing bound can appear in
neither. It snapshots on open, because the modal pushes a scope the moment it draws and would
otherwise answer a question the reader did not ask. What the sheet adds is the `detail` sentence the
footer has no room for. `chrome.test.tsx` asserts the two lists are equal in both directions: a row
the engine never reported is the sheet naming a dead key, and a hint with no row is the footer
offering something the sheet cannot explain.

**Escape sits third, and that is a rule rather than an accident.** The footer cuts rather than wraps,
and the hints run move, act, back, then the chords, then the rest. `esc back` used to sit last in
reading order, which meant the line ran out before it on every screen we draw, the cheat sheet's own
footer included: the hint was in the list and no reader ever saw it. The scopes are a stack and
Escape pops it, and this row is the whole of what draws that depth, so `reachability.test.tsx` reads
the drawn line and not the list, at every depth the walk visits.

**A hint the top scope cannot honour is dropped.** A layer knows nothing about scopes, so inside a
`Modal` or an open `Menu` the region tier's Tab and its column pair are still registered and the
engine still reports them live. `regionsInScope() > 1` is the rest of the question and both hints ask
it. The pair asks it only where its word is `column`, because `fold`, `move` and `tab` are answered
inside the scope by the thing that has the keys.

**A region's name is not in the footer, and we are not adding it.** A `list-detail` pane draws two
titled frames and the caret sits in one of them, so which half has the keys is on the screen already
and is on it in place. A label at the left would cost the cells the hints are short of.

### Seeing what the keys did

`ACORN_TUI_KEYS_TRACE=1` writes one line per key to `keys.log` under the XDG state directory
(`$XDG_STATE_HOME/acorn/keys.log`, else `~/.local/state/acorn/keys.log`):

```text
17:08:29.001 key=f6      reason=binding-handled    focused=BoxRenderable#72 region=pane/body scope=overlay:2 steps=11
17:08:29.492 key=enter   reason=intercept-consumed focused=BoxRenderable#91 region=pane/body scope=screen    steps=0
```

The parsed key, what answered it and why, the renderable that had the keys, its region, how many
overlays deep the keys are, and how many renderables the store walked to answer. There used to be an
`agree` field beside those, for whether the renderer and the store agreed about where the keys were,
and it is gone with the second owner it was watching (§ Focus regions). It is
a `key:after` intercept in `keys/install.ts`, which runs once per key after dispatch and claims
nothing; the hyphenated `key-after` is not a hook name and registers nothing at all. Registered
without `release`, or every keystroke would log twice.

Two lines are a bug wherever they appear. `reason=no-match` on a key the footer offers is the footer
lying. `region=none` while the screen has regions means nothing owns the keys. The line quoted first
above is a third: the region layer answered Tab while an overlay held the keys, which is how a dialog
comes to be on screen and unanswerable.

The line ends with `steps=`, which is how many renderables the store's walks visited answering that
key. It is the number the focus model is supposed to bound: it should track the depth of the tree the
keys are in and not the number of rows in the region, so a `steps` that grows with a list is a walk
that has started scanning something. The counter is in `apps/tui/src/keys/regions.ts` and is off unless
this flag is on, because a counter nobody reads is a branch on every node of every walk.

The log is an appending stream opened once rather than an `appendFileSync` per key. The second thing
this flag is for is measuring, and a synchronous open, write and close on the loop that draws is a
trace that measures itself.

This is the first thing to turn on when somebody says the keys stopped working.

## What the terminal client reports

Off by default, and on it is the same five record kinds every other runtime builds.
[telemetry.md](../telemetry.md) owns the model, the switch and the collector; this section is what
this host adds to it and the two things about a terminal that shape how.

**Its stderr is the screen.** A log line written while the renderer owns the terminal scrolls the
frame and the shell reads as garbage until the next full repaint, so `apps/tui/src/main.tsx` replaces
`console.log`, `warn`, `error`, `info` and `debug` for the life of the run and prints what it caught
on the way out, after `renderer.destroy()` has handed the terminal back. The logger writes through
those same five, so a line written with `createLogger` still becomes a record and its printed half is
still held. That is the arrangement, not an accident: the record is what leaves, and the print is
what waits.

**A batch leaves the ordinary way.** The emitter is client-core's, the one the desktop renderer uses,
started from `main.tsx` with `runtime: 'tui'` and client-core's own poster. The poster goes through
the API client, which on this host is the platform seam, so a batch rides the broker with the device
token and the pinned certificate like every other request. Nothing about the transport is this
host's.

| Seam | Where | What it emits |
| --- | --- | --- |
| Every frame | `apps/tui/src/renderer.ts`, from `paint/screen.ts` | histogram `tui.frame`, four series told apart by `phase`: `total`, `layout`, `paint` and `flush` |
| Every key press | `apps/tui/src/keys/install.ts` | histogram `tui.key` with the dispatcher's `reason`; histogram `tui.key.steps` when the step counter is on |
| The boot account | `apps/tui/src/boot.ts` | span `tui.boot` with a `tui.boot.mark` child per mark |
| Everything client-core already reports | see [telemetry.md](../telemetry.md) § Renderer seams | requests, commands, page changes, pane regions, trees, notices, contribution errors |

A frame is a histogram and never a span, because a held arrow key draws far past ten a second
(telemetry.md § Hot seams are metrics). The split costs four `performance.now()` reads on the paint
path, about 160 nanoseconds against a 5 millisecond frame budget, and it is unconditional so there is
one code path rather than two. `phase` is a label rather than four seam names, so "which third is
slow" is a filter.

`tui.key.steps` is how many renderables the focus store's walks visited answering one key, the same
number the trace line ends with (§ Seeing what the keys did). It is collected only with
`ACORN_TUI_KEYS_TRACE` on, because the counter is off without it, and its unit reads as milliseconds
because the emitter's fold writes one. It is a developer's own measurement rather than something an
ordinary run sends anywhere.

The boot marks are turned into spans after the fact. The switch is a preference on the node and the
answer arrives a round trip after the shell has drawn, so a span emitted where the mark was taken
would always be built with collection off and dropped. `apps/tui/src/boot.ts` holds the marks anyway,
for the `[acorn:boot]` account it prints on the way out, and `App.tsx` turns them into one trace the
first time the preference reads yes.

Three files print to the terminal and are not log lines: the pairing banner and its instructions in
`apps/tui/src/node/pair.ts` and `apps/tui/src/node/open.ts`, which a person is sitting there to read
before any renderer exists, and the data-root path in `apps/tui/src/platform.ts`, which is what "open
the data folder" means where there is no file manager. `tools/arch/boundaries.test.ts` holds those
three as a baseline that may only shrink.

### The invariants

Eleven sentences about the keyboard, each one a test rather than a scenario. A scenario pins one
path, and every bug the fourteen focus fixes chased was a path nobody had written a scenario for.
`apps/tui/src/reachability.test.tsx` walks every stop on eight surfaces, which are the browse rail,
the six panes the pane sweep opens, and the cheat sheet as an open dialog. It asks five of these
after every press, so a new pane or a new control joins the property the day it lands.

| # | The invariant | Where it is checked |
| --- | --- | --- |
| 1 | Every stop a region declares is reachable from the keyboard. | `reachability.test.tsx`, against `_allStops()` |
| 2 | Every stop acts: focusing it and pressing Enter calls the handler. | `kit/kit.test.tsx` § every control is a stop |
| 3 | One caret. At most one `›` is on screen and it marks what has the keys. | `reachability.test.tsx`, after every press |
| 4 | Escape is bounded and ends in the rail. | `reachability.test.tsx` § escape is bounded |
| 5 | One deferred decision: `queueMicrotask` appears once in `keys/` and never in `kit/`. | `invariants.test.ts` |
| 6 | Focus never sits on a corpse. | `reachability.test.tsx`, after every press |
| 7 | No chord this host cannot press: `super+` is spelled only where it is rewritten. | `invariants.test.ts` |
| 8 | The footer tells the truth: the word beside a key is what that key does there. | `reachability.test.tsx`, against the word table |
| 9 | There is one focus value, and it names a node that is in the tree and can hold the keys. | `reachability.test.tsx`, after every press. Made structural by the one owner: `setFocusedNode` appears once, `.focus()` and `.blur()` once each and both in the caret mirror, no source outside a test asks the renderer what has the keys, and `focusable =` appears only where `invariants.test.ts` allows it. |
| 10 | Focus is inside the top scope: with a dialog open, no key moves the keys out of it. | `reachability.test.tsx`, after every press on the overlay surface |
| 11 | A claimed key changed something. A handler that changed nothing returns `false` and the key bubbles. | `reachability.test.tsx` § crossKeys, which presses `h` and `l` on every kind of focused thing the walk met and asks whether the footer's word came true |

Two of them changed on contact with the build. Invariant 3 also promised one lit control, and it is
not checked: focus draws `strong` and `accent`, and so does an active tab label, so a span count
cannot tell the two apart and a test that cannot tell fails on a passing screen. Invariant 4 promised
`depth + 1` Escapes, counting the parent stops above the caret; that is short by the region chain,
which on a task pane is two more hops — the pane's region climbs to the strip and the strip climbs to
Tasks. The bound the test uses is the parent stops plus the chain `chrome/topology.ts` names.

The walk itself is Tab major and `↓` minor: inside whichever region has the keys, Down until the caret
stops moving, then Tab to the next region. A failure names the surface, the size and the line it could
not reach, and pressing the same keys in the same order puts the same thing under the caret. Right
and Enter are not in the walk, because what the property is over is `stopsIn` per region and a panel's
contents are the level below.

### What must never happen

- A second keymap, or key handling in a component. Every key goes through `@opentui/keymap`'s layers.
- A node that handles `ArrowDown`. Nodes handle `next`.
- Focus state a node owns. The host owns it on both hosts.
