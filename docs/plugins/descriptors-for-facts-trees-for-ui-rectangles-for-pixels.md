# Descriptors for facts, trees for UI, rectangles for pixels

[Back to plugins](../plugins.md)

## Descriptors for facts, trees for UI, rectangles for pixels

The rule of thumb, and it is a refusal as much as a guideline. **A descriptor is a fact the host
draws. A tree is UI, written in the host's own components. A rectangle is pixels the host cannot
draw.** Ask which of the three a surface is, in that order, and take the first that fits.

A status chip, a footer badge, a menu row, a palette entry: each is a fact, and each as an iframe
would cost a process-isolated document, could never look native, and would be dead whenever no frame
of that plugin happened to be mounted. So none of the small surfaces are open to frames, and the
answer to "I want a chip in the topbar" is to grow the descriptor vocabulary rather than to open a
slot id to an iframe.

A pane, a reference panel body, a settings page, a card in somebody else's list: those are UI, and
they are trees. The plugin's bundle names the host's own components and the host draws them, so the
result has the shell's keyboard handling, focus, ARIA and the reader's chosen style pack, and the
same source runs compiled in this process or sandboxed in a worker.

A PTY, a webview, a canvas, a code editor: those are pixels, and they are rectangles. The rule used
to be "descriptors for chrome, frames for rectangles", which had only two answers and pushed every
pane into an iframe by default. The middle answer is the one the layout programme added.

**A static schema and a component tree are not the same object**, and conflating them is what made the
middle answer look forbidden for so long. A static schema is Slack Block Kit or Adaptive Cards: the
plugin sends JSON saying "a card with a title and three rows", the host has one renderer per block,
and every click is a round trip and a whole new blob. It is always one field short. Somebody needs an
`if`, then a loop, then a computed value, and a bad programming language has been invented inside
JSON. That is what this page refuses as "a widget toolkit in the wire format", and the refusal stands.

A remote component tree is the other thing. The plugin's code runs in a sandbox and renders with a
normal framework against a fake DOM; the fake DOM serialises to a tree of named host components and
streams mutations. Logic stays in the plugin. Pixels, theme, focus and accessibility stay in the host.
No conditional is ever written in JSON, because the plugin's real code does the conditional and emits a
different tree. Its vocabulary is the kit, which exists and is versioned already through
`@acorn/plugin-api/ui`, so the tree adds no second vocabulary and the schema never grows an `if`. The
word "DSL" is discouraged for it internally, because the word invites the first shape; it is a
component model with more than one renderer.

**One reversal, on the record.** `docs/editor.md` argued that "the moment the host renders
a plugin's list from data, someone has to design and eternally version a descriptor vocabulary … That
request will recur; the answer stays no." That refusal was aimed at a static schema and it still holds
against one. Its other half — that a frame can always draw what a descriptor cannot — is true and
unchanged: the frame survives as the rectangle, for pixels. What the tree adds is the tier between "a
list of facts" and "an iframe", which is where a tool card, a sidebar tab and a settings section live
and where nothing lived before.

Three things were considered for that tier and refused. **A remote subtree per item at volume** — one
per diff line, one per file-tree row — would be thousands of sandboxed mounts; facts pinned to items
are annotations, which are batched, host-drawn and indexable, and a remote tree is for a card, a tab or
a section, things that number in the dozens on a screen. **The hidden iframe as the sandbox** was the
cheapest path, reusing `app-plugin://`, the CSP and the bridge and never drawing; a Web Worker won
because it has no DOM at all, is lighter per plugin, and the bridge was a transport swap. The iframe
survives only as the rectangle. **First-party plugins through the remote root** would have been the
flattest possible story, and was refused for this programme: every first-party pane would pay the
sandbox hop, and the agents transcript's performance risk would land on it. First-party renders
directly against the same API, the two paths produce the same tree, so slots and focus work across
both, and making a first-party plugin loadable stays a later per-plugin decision.

That is why the `slots` enum is two names rather than the client's six, and why the refusals are
recorded next to it in `@acorn/protocol/plugin/contract.ts`:

| Manifest slot | Host slot | Why |
| --- | --- | --- |
| `footer` | `task.footer` | The task footer — the slot `docker-footer-badge` occupies. Invisible until a task is open. |
| `topbar` | `topbar.right` | The app's status bar, beside the node chip and the notification bell. The right home for a status chip. |

Refused, deliberately: `overlay` is the full-window layer that draws the config-trust gate, the plugin
trust dialog and the command palette — a contribution there would paint over the very prompts asking
whether to trust it. `drawer` is a dock with real UI in it, and its slot context carries shell
callbacks a descriptor cannot receive. `topbar.left` and
`task.switcher.extra` are members of the client's slot union with no host rendering them at all, so a
manifest naming one would parse and never appear.

Both host slots are rows in one registry now. `task.footer` had its own registry and its own `ctx`
member until 2026-08-27; folding them left the id as the only thing that decides which context a
component receives, which is what this table already assumed.

A rail row is not on that list at all, in either direction. It used to be a client slot called
`tabrail.task-row`, and Docker was its only user; what it actually handed out was permission to draw
arbitrary markup and position it in the shell's own pixel geography, which is how Docker's marker and
core's pin ended up in the same corner. It is gone. Rail status is published as data now, through the
compiled registry described under [Rail markers](descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md#rail-markers) below.


## Keeping a descriptor fresh

A descriptor's data comes from a route on the plugin's node half, so something has to say when to read
it again. There are three answers and they are not interchangeable.

**A declared `refresh`** is the fallback: seconds, floored at 30 and capped at a day. The floor is not
timidity — a descriptor read is one HTTP call *per node*, and one interval serves every plugin's chrome
at the lowest value anyone declared, so a plugin that asked for two seconds would be spending every
other plugin's budget as well as its own. Declare it for data that changes with nothing to trigger on.

**`ctx.events.status()`** means "re-read my chrome descriptors". The host binds it to the calling
plugin's id, so it refetches that plugin's rail rows, badges, collections and agent context on every
connected client, and nobody else's. It is right for "something happened" and wrong for "here is
another number". Use it after an action, not on a timer.

It used to be a content-free ping that refetched every descriptor of every plugin, and a terminal
flipping between working and idle fired one per edge. `bumpChrome` in
`packages/client-core/src/host/chrome/chromeData.ts` has kept a revision per plugin all along; the
socket subscription was the one caller that told it nothing.

**The plugin's own channel** is the fast path, and the one to reach for when data actually streams.

### Raising a notification

`ctx.events.notice({ taskId?, title, detail?, kind?, target? })` puts a row in the owner's bell. Both
tiers have it, and it is core's, so it works with every other plugin disabled.

Leave `taskId` off for something about the node rather than one task — a connection that expired,
setup that is incomplete. A compiled plugin names a `target`, whose `kind` it also registers a client
handler for with `registerNoticeTargetHandler`, so the row opens its own surface at the right thing. A
loaded plugin's `target` and `kind` are dropped and the host lands the row on that plugin's own rail
source instead, or the Settings page that lists it. Naming a target means naming another plugin's
handler and any resource in it, which is what `send` above refuses too, and the `plugin` kind it is
given is the one that stays out of the OS.

For what a target is, how the click gets there, and which kinds exist, see
[notifications.md](../notifications.md) § What a row points at.

### The live channel

A loaded plugin owns the WS channel namespace `plugin:<its-id>:*`. Its node half broadcasts on it with
the `ctx.events.send` it already had, its own frames subscribe to it by declaring the channel in
`permissions.events`, and each frame that arrives nudges that plugin's descriptors and nobody else's.

```js
// node half
ctx.events.send({ channel: `plugin:${ID}:sample`, cpu: 0.34, memory: 0.81 })
```

```js
// its frame
bridge.events.on(`plugin:${ID}:sample`, (sample) => paint(sample))
```

A compiled client half hears the same channel through `onPluginFrame(pluginId, channel, listener)`
from `@acorn/plugin-api/client`. The returned disposable belongs to the model or component root that
subscribed; GitHub's pull model uses it to replace a stale detail response after the node announces
`plugin:github:pr-synced`.

What a plugin puts on the frame beside `channel` is the payload, delivered to its frames unchanged.
Core reads the channel and nothing else, which is the same promise the WS envelope makes everywhere
(`@acorn/protocol/ws.ts`).

The first-party plugins use it for one thing: announcing that state they own has changed
(`plugin:github:pr-synced`, `plugin:notes:notes-changed`, `plugin:workflows:run-changed`, and so
on). The catalogue, the payload rule (state to re-read, never a delta) and the one exception — core
sends `plugin:<provider>:items-changed` itself after a mirrored-resource refresh, because the write is
core's — are recorded per plugin in git history (`git log -- docs/future/events`); the rule
itself is § Hearing another plugin below, and the emitted verbs are each plugin's `emits`.

Four properties worth knowing before building on it:

- **`send` is confined to that namespace, and the confinement is the definition.** A loaded plugin
  naming another prefix gets a throw, not a dropped frame. Before this it could post on `term:` or
  `workflow:` and impersonate core's own streams; a built-in still can, because a built-in owns real
  prefixes through `ctx.events.channel` and is compiled into the binary.
- **A loaded plugin still cannot claim a prefix.** `ctx.events.channel` remains withheld. Core claims
  the one `plugin` prefix on every loaded plugin's behalf and routes by the id inside the name
  (`client-core/host/plugins/pluginChannel.ts`), which is what lets this work across a message-passing
  boundary that a handler function could never cross.
- **Frames get every frame; chrome gets a coalesced one.** A subscribed frame is delivered each
  broadcast, paying for it through the bridge's own message budget. Chrome is nudged at most twice a
  second per plugin, because a rail row is a network read per node and a plugin sampling in a loop must
  not turn that into a refetch storm.
- **`nodeStats` does not participate**, and neither the declared interval nor a push reaches it: Fleet
  home reads it through a fan-out with no dependency accessor, so it refetches when the fleet list
  changes and not otherwise. A node statistic is a number on a card, not a live readout.

A frame may subscribe only to its **own** plugin's channel. Another plugin's is refused, structurally,
for the same reason another plugin's routes are — two plugins that need to talk use a capability. The
trust prompt draws one host-owned sentence for the grant and never the verb the manifest named, which
is the rule for every line in that group.

## Context menus

`contextMenus` is the declarative right-click contribution, and the registry behind it
(`packages/client-core/src/host/registries/panes/contextMenus.ts`) is core's as much as a plugin's: the tab rail's
own Pin / Unpin / Rename / Archive rows are registrations on it. That is the point — a contribution
contract whose only consumer is a third party is a contract nobody has used. Both doors onto a task row
(the button menu it already had, and the new right-click) draw the same list from the same registry, so
they cannot offer different things.

An entry is `{ id, location, label, icon?, order?, when?, action }`:

- **`location`** comes from a closed vocabulary (`@acorn/protocol/contextMenus.ts`). There are two:
  `task.row` is a row in the tab rail, and `item.row` is a row in an integration's list — a Rollbar
  error, a Linear issue, a GitHub pull request. The list grows when a surface appears to draw it,
  never ahead of one.
- **`when`** is a map of literals that must *all* equal the target's own facts — not an expression. A
  manifest is data, and a predicate language would need a parser, an evaluator and a decision about
  what it may call. `task.row` supplies `origin`, `projectId` and `pinned`; `item.row` supplies
  `providerId` and `projectId`. Naming anything else is a parse error, because a predicate that can
  never match is a contribution that installs and does nothing. Identity fields (`id`, `title`) are
  deliberately not facts: a menu row keyed to one task id is not an extension point.
- **`action`** is the *context-free* verb set — the same one a command and a slot badge take. A menu
  row can therefore do exactly what a command can do and nothing more. `createTask` and `navigate` are
  absent because the thing under the cursor is a **core** resource: the first needs the host's
  promotion callback over a rail item, the second a project-scoped surface of the plugin's own.
- The host binds the rest. The id becomes `plugin:<pluginId>:<id>`, so a package cannot take a core
  row's place; the row is hidden unless its plugin is running on the node being looked at; and the verb
  receives the id of the thing that was right-clicked, never an id the descriptor chose. There is no
  `tone` — a red row is a claim that an action destroys something, and that is core's claim to make
  about core's resources.

  ```json
  {
    "contributions": {
      "contextMenus": [{
        "id": "open-card",
        "location": "task.row",
        "label": "Open the board card",
        "icon": "kanban",
        "when": { "origin": "board" },
        "action": { "verb": "runNodeAction", "path": "/v2/p/board/open" }
      }]
    }
  }
  ```

### Three lists, one menu

`item.row` exists because three lists were each writing their own overflow menu: core's rail list for
descriptor sources (`ChromeSourcePanel.tsx`), which is Rollbar's and Linear's, and github's
pull-request list (`PullList.tsx`). Every one of them offered "Create task" and none of them could
gain a second row without gaining it three times. They all draw from `contextMenuItems('item.row',
target)` now, and each still contributes its own **Create task** row: core's promotes through the
source's registered `promotion`, github's finds or makes the pull's task with its Linear links. What
changed is that a fourth party can add a row — the workflows plugin's **Start workflow…** is the
first, and a loaded plugin's manifest is the next.

An `item.row` target carries more than its facts. `id`, `title`, `body` and `link` are the four things
every tracker has, and `item` is the provider's own row handed back untouched, which is what lets one
contribution serve three lists that agree on nothing else. None of those is a fact, so no `when` can
match on them.

Both halves of the registry are on the plugin API: `registerContextMenuItems` for a plugin adding a
row, and `contextMenuItems` with `runContextMenuItem` for a plugin that draws a list and wants the
registry's rows in it. No component crosses — the loop over those rows is eight lines with each host's
own `Menu.Item`, which is what keeps it working in a terminal.

Nothing here is reachable from a plugin frame. The registry is populated host-side from manifests the
device read; the frame bridge gained no message kind and no route, so a frame can neither open a menu
nor synthesise a selection on one.

## Rail markers

A **rail marker** is a small non-interactive status icon on a rail control: a task row, a rail source,
a pane button. A compiled plugin publishes markers through `ctx.railMarkers`, next to the state that
owns them:

```ts
ctx.railMarkers.register({
  id: 'docker',
  order: 50,
  markers: (target) => {
    if (target.kind !== 'task') return []
    const running = dockerTaskSummary(target.id)?.running ?? 0
    return running ? [{
      id: 'running',
      label: `${running} running container${running === 1 ? '' : 's'}`,
      icon: 'brand:docker',
      tone: 'accent',
      placements: ['top-start', 'bottom-start'],
    }] : []
  },
})
```

Three things are the host's, not the plugin's. **Where it goes**: `placements` is an ordered wish
list, and the host hands out the first entry still free, so two plugins asking for the same corner get
different corners rather than one on top of the other. **What it looks like**: `tone` is semantic, and
the host owns the colour, the spin, and the icon resolution — a plugin stylesheet positioning a rail
marker is a bug. **Whether it outranks anything**: contributed priorities are clamped below core's, so
a plugin orders its own markers among themselves and never pushes a core lifecycle state such as
"archiving" out of its slot. A marker that finds no free position keeps its place in the tooltip legend
and the control's accessible description; it loses the pixels, never the state.

Markers are descriptive. There is no click verb, because a marker lives inside a button and a button
inside a button is not a thing — the action belongs to the rail control itself, a context menu, or a
command.

The agents plugin is the other consumer, and it shows what "beside the state that owns it" buys. Its
marker is the task row's top-right corner: a turning loader while any agent in the task is moving,
replaced outright by the alert glyph the moment one needs the owner. Core used to draw that spinner
from terminal sessions alone, which meant a managed agent working away in the background left the row
looking idle. The plugin knows about both kinds, so it publishes one answer for both, in the same
shape vocabulary its pane header and task sidebar already use.

`markers()` runs inside the consuming render, so it may read signals the plugin already owns.
Registering through `ctx` rather than the registry directly is what lets the host take the markers back
out when the plugin is disabled. Loaded plugins cannot publish markers yet; the design for a batched,
node-scoped manifest contribution is in `docs/future/rail-tab.md`, and it waits for a loaded plugin
with a status worth publishing.
