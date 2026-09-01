# The terminal client, read for shape

Analysis, 2026-09-02. One of the two inputs to this programme. [focus-model.md](./focus-model.md)
is the other, and [README.md](./README.md) holds the order of work. Paths are hints, not promises.
Every claim below names the file it was read from.

## The verdict first

The architecture is right. The seams are the right seams and they are in the right places: one
keymap engine with intents in front of every component, a component table per host, a layout table
per host, a source-panel seam, a remote-tree seam, a worker factory, and a region contract that the
terminal keeps while replacing every DOM mechanism under it. None of that needs redrawing, and the
two OpenTUI workarounds in the reconciler and the render guard are deliberate, documented, and
tested.

Two things are hacked, and between them they account for the jank.

**The asking half of the kit does not ask.** `Button`, `ConfirmButton`, `Link`, `Chip`, `Checkbox`,
`ToggleButton`, `Select`, `Picker`, `SegmentedControl`, `Fold`, `Card`, `TableRow`, and the submit
half of `Composer` draw their characters and wire nothing. `apps/tui/src/kit/asking.tsx` § `Button`
is a `Line` with the label in brackets. The focus-role table says every one of them is a stop or a
collection (`packages/client-core/src/kit/tokens/focusRoles.ts`), the support matrix says `full`
(`packages/client-core/src/kit/tokens/support.ts`), and the kit tests assert only the characters
(`apps/tui/src/kit/kit.test.tsx`). So the pull-request pane's Merge button, its comment composer,
Approve, Request changes, Rerun, and every label chip are on screen and unreachable. This is the
whole of "I go down from the tabs and cannot get to the controls": there are no controls to get to,
only pictures of them.

**The focus store grew by accretion.** `apps/tui/src/keys/regions.ts` is 533 lines. Its header says
the module is the keys' and must not reach into the shell, and its `moveBack` reads
`paneId === 'chrome' && regionId === 'browse'`. Four option flags (`column`, `enterMainOnActivate`,
`opensHere`, `pickOnEnter`), two `WeakSet`s for two kinds of tab strip, an identity map for rows a
query replaced, a `provisional` flag, an `opened` flag, and six deferred focus decisions in
`queueMicrotask` were each added to fix a real bug in the fourteen commits since 2026-08-31. Each
fix is correct on its own. Together they are a state machine nobody wrote down, and the bugs the
shell keeps finding are the transitions nobody drew: a lit frame with no caret, focus on a destroyed
row, Enter that moved focus without opening, a chord that did nothing from the rail.

Everything else that looks odd is a decision with a reason written beside it, and this analysis
leaves it alone.

## The boxes and the seams

```text
packages/client-core (shared, host-neutral)          apps/tui (this host)
────────────────────────────────────────────          ─────────────────────────────────────────────
kit/keys/intents.ts        the 18 intents      ──▶    keys/install.ts     engine adapter, layer 5,
kit/keys/keymap.ts         key → intent table  ──▶                        Tab added to nextRegion
kit/keys/keymapHost.ts     setKeymap, layers   ──▶    keys/commandLayer.ts layer 0, super→ctrl
kit/keys/collectionIntents the list rules      ──▶    keys/collection.ts  land(), onItem(), claim
kit/keys/collectionState   active/selected     ──▶    (read unchanged)
kit/tokens/focusRoles.ts   declared roles      ──▶    kit/asking.tsx, showing.tsx, grouping.tsx
                                                        ▲ GAP: roles declared, not realised
host/layouts/regions.ts    LayoutProps         ──▶    layouts/*.tsx → regionFocus(ref, order, flags)
host/keys/focusRegions.ts  DOM regions         ║      keys/regions.ts    TUI regions
                                                        ▲ STRAIN: shell topology as flags + literals
host/chrome/sourcePanel.ts seam                ──▶    plugins/SourcePanel.tsx
host/tree/arbitration.ts   who fills a slot    ──▶    kit/host.tsx Slot, plugins/RemoteTree.tsx
host/tree/treeState.ts     batch rules         ──▶    plugins/TreeHost.tsx
host/chrome/ExtensionPointHost.tsx (rows)       ✗     no counterpart
host/registries/extensionPoints/uiSlots.tsx     ✗     no counterpart
host/frames/InlineSlot.tsx (rectangle)          ─      one muted line, by design

chrome/Shell.tsx, Rail.tsx  the arrangement    ──▶    registers regions into keys/regions.ts
                                                        with orders −130…−50 and the four flags
                                                        ▲ COUPLING: the keys module reads chrome ids back
```

Read down the left and everything is a contract two hosts share. Read down the right and every
module but two is a faithful realisation of the contract above it. The two are marked.

## What is good, and should not be touched by this programme

- **Intents before components.** No component in `apps/tui/src` handles a key name. `Tabs` binds
  `left`, `right`, `down`, and their letters, which is the one place a kit node spells keys, and it
  spells the same keys `intentKeys` does.
- **One engine, four tiers, priority decides.** `apps/tui/src/keys/install.ts` documents 0, 5, 30,
  40, 45 and every layer in the package sits on one of them. The trap swallow at 35 has its reason
  written beside it (`apps/tui/src/keys/trap.ts`).
- **The reconciler seam.** `insert` and `createElement` replaced once, in front of every JSX call,
  with the four crashes they ended named in `docs/tui.md` § Rendering. `browseSlow.test.tsx` pins the
  destroy race with a real latency knob.
- **The region contract.** Order declared by the layout, first stop by walking the retained tree,
  focus owned by the renderer. That is the DOM contract with the DOM removed, and the layouts that
  call `regionFocus` are short and alike.
- **Select-on-move, Enter opens.** `Rows` passes `selectOnMove` everywhere. Arrowing shows, Enter
  opens. Menu and Browse pick the row they land on. This is the right terminal answer and the tests
  agree with it.
- **The harness.** `apps/tui/src/harness.tsx` drives the real shell with real keys and reads
  `focusedRegion()` back. `spatial.test.tsx` and `sections.test.tsx` are the shape every test in
  this programme takes.
- **The previous design's refusals.** `docs/future/terminal-fixes/` (deleted 2026-09-01, in git
  history under `git log --follow -- docs/future/terminal-fixes/README.md`) refused a new chord for
  rail-to-main, refused wrapping the column move, refused a source model with no consumer, and
  refused hiding the Browse frame. All four still hold and [refused.md](./refused.md) carries them
  forward.

## The findings

Numbered so a phase can point at one.

### 1. Controls are drawn, not wired

Read `apps/tui/src/kit/asking.tsx` top to bottom and count the nodes whose handler prop is used:
`Input.onSubmit`, `Input.onInput`, `Textarea.onInput`, and `ConfirmButton` passing `press` to a
`Button` that drops it. That is the list. `Composer.onSubmit` is never called: its `Textarea` has no
submit path, its `Button` is inert, and the `commit` intent is bound nowhere in `apps/tui/src`.
`Select` and `Picker` build a `Menu` whose trigger has no press, so the list never opens. `Checkbox`
draws `[x]` and cannot toggle. `Fold` toggles on `onMouseDown` only. `Link` is a styled `text`.
`Chip` draws the `✕` when `onRemove` is set and never calls it. `Card` and `TableRow` accept
`onPress` and ignore it.

Three tables claim otherwise. `focusRoles.ts` gives each of these `stop`, `collection`, or
`conditional`. `support.ts` gives each `tui: 'full'`. `docs/ui-design.md` § Every node at 80 by 24
writes "Space toggles" beside `Checkbox` and "commit submits" beside `Composer`. `kit.test.tsx`
renders each and checks the characters, so all three tables pass their tests while describing a
host that does not exist.

The consequence in the pull-request pane, which is the surface the programme is judged on: the
strip is a parent stop and Down enters the Details panel, where `focusStops` finds nothing
focusable and falls back to the `ScrollViewport`. Arrow keys scroll. Merge, Close, the merge-method
`Select`, the composer, Approve, and Request changes are text. No comment can be posted from the
terminal, no pull can be merged, no agent message can be sent from an agents-pane composer.

### 2. The keys module knows the shell

`apps/tui/src/keys/regions.ts` § `moveBack` finds Browse by literal id and the pane strip by literal
id. `moveColumn` decides that a region with `order >= 0` is "real content", which is a fact about
the numbers `Shell.tsx` and `Rail.tsx` chose. `regionFocus` takes four flags and every one of them
is passed by exactly one caller in `chrome/`. The module's own header says it takes a pane cycler
rather than importing the shell so that it does not depend on the chrome, and then depends on it by
string.

The right shape already exists in the same file: `setPaneCycler`. The shell installs the one thing
the keys module cannot know. The rest of the shell's knowledge should arrive the same way, as one
topology object, and the literals and the `order >= 0` test should go.

### 3. Six deferred focus decisions race each other

Every `queueMicrotask` in the keys folder and the collection nodes is a focus decision made after
the render that caused it, because the renderable it needs does not exist until then:

| Where | Decides |
| --- | --- |
| `regions.ts` § `regionFocus` | which region opens the screen |
| `regions.ts` § `markItem` cleanup | re-enter a region whose focused row was destroyed |
| `regions.ts` § `takeFocus` | land in an overlay |
| `regions.ts` § `takeFocus` cleanup | restore after an overlay, or re-enter if the row went |
| `collection.ts` § `attach` effect | claim a provisional region when the list arrives, or re-land after a refetch |
| `showing.tsx` § `Rows` window effect | drop the container's focusability once the active row is back |

Plus `provisional`, `opened`, and the identity map, which exist to let one of these tell whether
another already ran. Each was the fix for a bug a test now pins. The class of bug is the same every
time: two of them run in an order the author did not picture. There is one moment when every
renderable of a render exists and none of the next render's do, and one pass that runs there can
make every one of these decisions in a fixed order. That is what the DOM gets for free from
`focusin` and `isConnected`, and it is what this host should build once rather than six times.

### 4. Two kinds of tab strip, one visual

`markTabStop(node, entry)` distinguishes a structural strip (Down enters its panel, Escape returns
to it) from a filter strip (an ordinary control). `Sections` and the `tabs` layout pass `entry`;
`PaneStrip` and a plugin's own `Tabs` do not. So GitHub's pull request, drawn with `Sections`, has
the tabs-then-Down behaviour, and Linear's issue and Rollbar's item, drawn with `Tabs` and
`TabPanel` as siblings in a `Stack` (`plugins/linear/src/tree/LinearIssueView.tsx`,
`plugins/rollbar/src/tree/RollbarItemView.tsx`), do not. A reader cannot tell the two apart on
screen. The distinction that matters is not a prop but a fact about the tree: does this strip have
panels? A `Tabs` whose `idPrefix` matches sibling `TabPanel`s does; GitHub's Open and Closed filter
does not.

### 5. Chords spelled with a key the terminal cannot deliver

`apps/tui/src/layouts/Tabs.tsx` binds `super+1` through `super+9`. macOS terminals never deliver
Cmd, so the chord is dead, and the command layer's `asCtrl` rewrite does not reach a `bindKeys`
call. `apps/tui/src/layouts/split.ts` binds both `super+shift+arrow` and `ctrl+shift+arrow`, which is
the author meeting the same bug and hedging. Nothing checks for the string `super+` in this package.

### 6. The Escape ladder is a heuristic over a flat list

`moveBack` walks `focusStops(region)` backwards from the focused node looking for an entry strip.
That finds the strip above a panel's content because the strip is earlier in reading order. It has
no notion of depth: a control inside a fold inside a panel, or a reply composer inside a comment
card, has no level between itself and the strip. Once finding 1 is fixed the panels will hold
stops, and "the nearest strip earlier in reading order" is the wrong parent for the second strip
in a panel that holds two.

### 7. Documents with one control lose their scrolling

`focusStops` treats a `ScrollViewport` as a stop only while it holds none. The first `Button` a
panel gains takes that away, and there is no rule for what Up and Down mean inside a long document
that has stops in it. Today the question does not arise because there are no stops. Phase 0 raises
it on the first day, so [focus-model.md](./focus-model.md) answers it before phase 0 lands.

### 8. Region entry priority is a list of special cases

`firstStop` tries, in order: an entry strip, a collection row, any strip, the first stop. The order
encodes "Browse must land on its rows even though GitHub's filter tabs are above them" and "a detail
must land on its strip". Both are right. The rule they are instances of is: a region enters on its
first *parent* stop if it has one, else its first collection, else its first stop, where a parent
stop is a strip with panels. A filter strip is not a parent, so Browse lands on rows without a
special case.

### 9. Extension points cross unevenly

Read against `docs/plugins.md` § Cooperative extension points and the registries under
`packages/client-core/src/host/registries/extensionPoints/`:

| Kind | Desktop | Terminal |
| --- | --- | --- |
| `remote` tree slot | `host/tree/Slot.tsx` | `apps/tui/src/kit/host.tsx` § `Slot`, full parity, shared arbitration |
| exclusive slot (`rail.taskList`) | `host/plugins/ExclusiveSlotHost.tsx` | `apps/tui/src/chrome/slot.tsx`, full parity |
| `annotation` marks | `host/annotations/AnnotationMarks.tsx` | `kit/host.tsx` § `AnnotationMarks`, drawn; but `apps/tui/src/kit/showing.tsx` § `DiffPane` takes `annotations` and never reads it, so `github:diff-line` and `changes:diff-line` deliver nothing |
| `rows` (`pane.footer`) | `host/chrome/ExtensionPointHost.tsx` | absent, no counterpart and no seam |
| `pane.aside` dashboards region | `host/chrome/ChromeExtendedPane.tsx` | absent |
| `rectangle` (`pane.inline-*`) | `host/frames/InlineSlot.tsx` | one muted line, by design |
| host UI slots (`overlay`, `drawer`, `task.footer`, `topbar.*`) | `host/registries/extensionPoints/uiSlots.tsx` | absent; onboarding's overlay, the terminal drawer, docker's task badge draw nothing |

One of those is a crash in waiting rather than an omission. `host/frames/register.ts` mounts the
DOM `ExtendedPane` around any loaded plugin pane that declared a footer, aside, or inline point, and
`host/plugins/syncContributions.ts` runs on this host from `apps/tui/src/main.tsx`. A loaded plugin
that declares `pane.footer` hands the cell reconciler a `<div>`, which is "Unknown component type"
and a dead pane. There is no host seam for `ExtendedPane` the way there is for the layout table and
the source panel.

For keyboard reach, an extension's content is reachable exactly as far as the kit nodes it draws
are, inside the region its host layout registered. A grafted tree that draws `Rows` is reachable
today. One that draws `Button` becomes reachable with phase 0. Nothing lets an extension open a
region or a stop of its own, and nothing should: the region belongs to the layout.

`docs/tui.md` § What a plugin loses here says "Nothing, from the plugin author's side". The table
above is what the author loses, and the doc should say so once this programme decides which rows
stay lost.

### 10. Tests pin frames, not paths

The chrome, spatial, sections, and browse suites read `focusedRegion()` and the caret line, which is
the right instrument. No test presses Enter on a control, because none can be pressed. No test
walks every focusable thing on a pane and asks whether the keyboard can reach it. No test asserts
that Escape from an arbitrary stop reaches the rail in a bounded number of presses. Those three are
the properties the programme is for, and [phase-6-tests-and-docs.md](./phase-6-tests-and-docs.md)
adds them as properties over the roster rather than as one scenario per bug.

### 11. The footer's words lag the model

`apps/tui/src/chrome/bindings.ts` names `h/l` "fold" and `enter` "open" wherever the keys are live.
On a strip `h/l` chooses a tab and on a control `enter` presses. The footer is the only place a
reader learns a key, so the word has to match what will happen where the caret is.

### 12. The docs describe the intended host

`docs/tui.md` § Navigation says "a tabbed detail adds one deliberate level: `down`/`j` enters its
controls". `docs/command-palette-and-shortcuts.md` § Focus and typing says the same. Both are true
of the design and false of the build, for the reason in finding 1. The programme ends by making the
sentences true rather than by editing them.

## What this programme is not

It is not a rewrite of `apps/tui`. Twelve of the thirteen files under `keys/` and `chrome/` keep
their names and most of their lines. It replaces the inside of one module, wires handlers that
already have props, adds one helper for controls, one pass for settling focus, one topology object,
and a test tier. It does not add a keymap, a chord, a vim mode, a mouse model, or a node the kit
does not have.
