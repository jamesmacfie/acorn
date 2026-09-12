# Descriptors

[Back to plugins](../plugins.md)

## Descriptors

A rail source, a badge in the task footer or the topbar, commands and keybindings, attention items,
node stats, context-menu rows (`contextMenus`), restricted URL recognizers (`contentLinks`), renderer
routes (`routes`), agent-context entries (`agentContexts`), batch reference resolvers
(`refResolvers`), typed record sets (`collections`), periodic node-side work (`schedules`), and colour
themes (`themes`). These are data, not code: the host renders them with its own components and fetches their content
from routes in the plugin's own `/v2/p/<id>/` namespace, so they stay live when no frame is
mounted anywhere (`packages/client-core/src/host/chrome/`). Freshness rides the existing
invalidation ping plus one shared timer. A plugin that ships only descriptors needs no client
bundle at all, and therefore no trust prompt — nothing of its executes on the device. A source may
declare `createTask`; its row supplies the task seed and optional external link, while the host owns
the modal, origin namespace, connection ownership check, create-before-link ordering, and
partial-failure reporting. A source may declare `projectScoped`, which says its items route reads
the shell's project: the host then appends `?project=` to that route, keys the cache by it, and
offers the topbar project picker while the source is on screen. It is opt in, so a manifest written
before the field and a plugin that never thought about projects both get one shared list instead of
an identical one refetched per project (docs/frontend.md § the router is registry-driven). A source may also declare an `emptyState` — one bounded message and at most
one context-free action — shown when its route answered with *no items*, in place of the host's fixed
"Nothing here yet.". Not when the fetch failed: an unreachable node already has its own banner, and
telling someone "nothing is assigned to you" because a request timed out is a claim the host has no
business making on a plugin's behalf. It is deliberately no richer than a sentence and a button; the
field exists because a rail that cannot say what empty *means* pushes sources into showing a wrong
list instead of an empty one, which is exactly what Linear did. `emptyState` belongs to this
descriptor twin only (`@acorn/protocol/api.ts` § `PluginSourceEmptyState`): a first-party
`SourceContribution` is a component and already renders whatever it wants when it has nothing, so
the same field there would be one every first-party source carries and none reads. A `contentLinks` entry uses a
bounded `https://` host/path grammar and delivers one captured path segment to one of **three**
destinations: an optional **task-scoped** `openPane` from the same manifest, which receives it as a
`plugin:select` intent in the active task; the plugin's own **reference panel**, shown over
whatever the reader was looking at; or the plugin's own **route**, which takes the reader there —
declared as a `path` resolver on a compiled recogniser, since only the owning plugin can turn a URL
into one of its addresses (`plugins/github/src/client/contentLinks.ts` resolves owner/name to a
project). Taking a route also selects the rail source that owns it, because the shell renders from
the rail rather than from the location. A link must have at least one of the two, or the manifest is
rejected — a recogniser that matches URLs and can never open anything looks installed and is not.
Which destination a click gets is the *clicking surface's* call and not the manifest's, because it
depends on where the link was: a pull-request conversation asks for the panel so the reader keeps
their place, a note takes the pane, a dashboard row asks to be taken to the route. Each is a
*preference*, and the host falls through the remaining two in a fixed order when the asked-for one is
unavailable, so no surface has to know which destinations a given provider actually installed. The panel is never *named* — it is addressed by provider, the host stamps
the plugin id onto every recogniser it registers, and a `refPanel`'s provider must already be the
plugin itself, so a manifest cannot point a link at another plugin's panel. Likewise a target naming
anything that is not a registered task pane resolves to nothing rather than pushing an unrenderable
pane id into a task's persisted layout. A `routes` entry gives a project-scoped surface a URL. Its
A source may also declare **`tracksRef`** — "does this task already track this external item?" — which
is `taskPath` read backwards and exists for the same reason. `task.links` is not the only way a task can
be attached to an external item: a github-pr task records its pull request as `pullNumber` on the task
row, and its links hold the *Linear* tickets found in the PR body. The host asks links first, since that
is provider-agnostic and covers everything that seeds them, then asks every source for its own second
spelling. A source that has only one way of recording the relationship implements nothing.

A source may also declare **`defaultPane`**, the pane a task it tracks opens on the first time it is
activated. Like a content link's `openPane`, it is re-checked on the device against the panes this
manifest declares, so a roster row cannot aim core's first-open at somebody else's pane.

`path` is confined at parse time to the prefix the host mints from the plugin id —
`/p/:projectId/x/<plugin-id>/` — so it cannot claim core's `/p/:projectId`, `/p/:projectId/new`, or
another plugin's path, and a collision is a manifest error rather than a race between two loads. It
names a project-scoped `surface` from the same manifest and one `item` parameter of its own path;
the host does the matching and supplies the value. A source's `onSelect: { "verb": "navigate",
"surface": … }` is what changes that URL from a clicked row — the URL is where a project-scoped
surface's selection lives, because unlike a task pane it has no layout state to keep one in. A
command may not carry `navigate`, for the same reason it may not carry `createTask`: a command
registry row has neither a routed project nor the shell's navigator in scope. A slot badge's
`onClick` takes the same narrowed verb set as a command — `openPane`, `runNodeAction`, `openUrl` —
for the same reason: its click carries no selected row and no routed project, so a verb that needs
either would parse and then only ever fail. Only a source's `onSelect` gets the full set, because a
rail row is the one click site with a row, a project, and the promotion callback in scope.
`surfaceAction` is the one verb whose effect lands *inside* a plugin rather than on the shell: it
delivers the command's own id to a region of one of that plugin's own panes, and it may only name a
pane the same manifest declares that draws such a region — an iframe or a worker tree qualifies alike,
and a pane whose regions are all host-drawn does not, because there would be nothing on the far end of
the bridge to receive it. A document beside the region is not required. The verb was born in a
`document-over-frame` pane, where `⌘Enter` is pressed in the host's editor and the frame has no
keyboard (§ Document surfaces above), but the palette is the other way in, and from there "do this in
the thing I am looking at" is a sentence about any pane the plugin draws — http's `list-detail`
request panel as much as database's editor-over-panel. It is useful only on a
command, because what it delivers *is* the command id, and a footer badge has no command in scope. An `agentContexts`
entry names two routes — `options`
(GET) and `capture` (POST) — and puts a row in the agent composer's context picker. Its `capture`
answer is the one descriptor response that ends up inside a model's prompt, so it is parsed against
a schema rather than sniffed field by field, and the host binds what a plugin must not: `source`
comes from the plugin id, the capture time is stamped here, and the bytes are measured from the
content received rather than believed from the response, so the shared 512 KiB
`MAX_AGENT_CONTEXT_BYTES` ceiling cannot be talked past. An over-budget capture is refused whole,
never trimmed. The `revision?()` half of the first-party contract has no manifest form on purpose:
it is synchronous, a descriptor answers across a fetch, and the invalidation ping already covers
freshness. The whole entry is two routes and a label:

```json
{
  "contributions": {
    "agentContexts": [{
      "id": "http-requests",
      "label": "HTTP requests",
      "description": "Saved requests and their latest responses",
      "options": "/v2/p/http/agent-context/options",
      "capture": "/v2/p/http/agent-context/capture"
    }]
  }
}
```

`options` answers `GET → [{ id, label, description?, defaultSelected? }]` for the picker; `capture`
receives `POST { taskId, workspaceId?, optionIds? }` and answers
`[{ contextId, label, content, resourceId?, provenance?, deepLink?, freshness?, sensitivity? }]`
(`@acorn/protocol/agentContext.ts` is the schema). Everything else on a snapshot — `source`,
`capturedAt`, `byteSize`, `estimatedTokens` — is measured and stamped by the host, never read from
the response.

A `refResolvers` entry is the same carrier shape for a different question: **what another plugin's
surface should draw** when it is holding identifiers of this plugin's items. Recognition already has
an answer — `contentLinks` declares the URL shapes, and the host scans any text for every registered
recogniser at once (`scanContentRefs`) — so this is only the enrichment half, and it exists because
the alternative was a cross-plugin import (`github` importing `@acorn/plugin-linear/contract`) that
cannot survive either side becoming a loaded package.

```json
{
  "contributions": {
    "refResolvers": [{
      "id": "linear-refs",
      "kind": "linear.issue",
      "resolve": "/v2/p/linear/issues"
    }]
  }
}
```

The host POSTs `{ identifiers }`, count-capped, and parses the answer as
`[{ identifier, label, state?: { name, color, kind }, url? }]`
(`@acorn/protocol/refResolvers.ts`). `providerId` is **not** in the body — the host stamps it from
the plugin whose route answered, the same rule that stops a recogniser claiming another provider,
because a row that could name its own provider could publish a stranger's items behind a stranger's
reference panel. A consumer addresses a resolver by provider and never by route
(`refResolutionsOptions` in `client-core/host/registries/panes/refResolvers.ts` owns the query key and a
five-minute staleness for every provider alike), so a surface enriches Linear and a tracker nobody
has written yet with the same call.

The response vocabulary is deliberately a label and a state chip, and should stay that way. Every
field added here is a field *every* provider's answer gets rendered with, which is the descriptor-tier
slope this tier has declined more than once. The route spends provider credentials on a cache miss,
and is already behind `requireProviderAccess` through the provider mount — that gate is the
authorisation, the identifier cap is the budget, and neither replaces the other.

A `collections` entry is the descriptor tier grown one size: from a node stat's one integer with a
label to a **typed set of records**. The plugin declares what a route answers with — fields with a
semantic `type`, an optional `role`, and their display hints — and the host draws the rows with its
own components. It is the same argument the rest of this tier makes, at the point where it stops
being obvious, so the boundary is worth stating: this does **not** reverse the master/detail refusal
below. What was refused is reproducing a plugin's *bespoke* UI from data, an unbounded fidelity
chase; a collection feeds the host's *own* generic surface, where uniformity across providers is the
entire point — two plugins' rows can only share one board if neither of them draws anything.

```json
{
  "contributions": {
    "collections": [{
      "id": "issues-mine",
      "name": "My Linear issues",
      "items": "/v2/p/linear/collections/issues-mine",
      "refresh": 600
    }]
  }
}
```

The route answers `{ schema: { fields }, rows: [{ id, values, action? }] }`, parsed against
`@acorn/protocol/collections.ts`. `(pluginId, collectionId)` is the universal reference and nothing
else addresses a collection. Four rules carry the whole design:

- **The field vocabulary is closed and budgeted**: seven types (`text`, `number`, `boolean`,
  `datetime`, `enum`, `person`, `link`) and five roles (`title`, `status`, `assignee`, `url`,
  `updated`). Semantic rather than primitive, because the type is what lets the host render a person
  as an avatar and *derive* which views a collection supports — only an `enum` can become kanban
  columns. Every type added is a rendering rule every provider inherits forever; when the vocabulary
  cannot express something, the answer is a frame pane, not a wider wire format.
- **Display hints live on the field, never on a panel** — a `number`'s unit, an `enum`'s declared
  values with their labels and tones — so they survive a view switch and a cross-source mapping.
- **Row identity is required and provenance is host-stamped.** `id` must be stable across refreshes;
  `pluginId` and `collectionId` are not in the body at all, and the host binds both from the
  contribution whose route answered — the same rule as `refResolvers`' `providerId`, for the same
  reason. A mixed board routes clicks on that stamp.
- **A row action takes the context-free verb set only.** A panel row has no rail row to promote and
  no routed project to substitute, so `createTask` and `navigate` are not in the union. `openTask` is
  in it, and is the one verb that needs nothing but the row's own `taskId`: go to that task and stop,
  for a row whose thing *is* a task. From a click site with no row, a command or a slot badge, it has
  nothing to aim at and the host refuses it out loud rather than doing nothing. An action
  may declare an optional `risk` tier — `read` | `write` | `execute`, the same vocabulary an agent
  tool uses — and anything above `read` is armed: the *host* draws the confirmation from the tier
  and dispatches nothing until it is accepted. Never a new verb, and never plugin-drawn
  confirmation UI, because a plugin that could draw its own dialog could draw a reassuring one over
  a destructive call.

A collection may also declare `params`: up to eight named inputs, each `text` or `enum`. The host
renders one control per param in the panel editor and appends the values to the route as query
parameters; it never interprets them. The plugin owns what `repo` means, and the day it means
something else the host does not change.

The manifest `schema` is optional, because the response carries its own. The declared one is the
*static* case — a promise about the route, so an editor can offer views before any data exists — and
a collection whose columns cannot be known at build time simply omits it. Linear does: only a Linear
workflow state's `type` means the same thing in every workspace, so its rows group by the type and
the response labels each group with the workspace's own name for it. A malformed page is dropped
whole and logged, never half-parsed: a table missing some of its rows reads as complete and is not.
The cost of omitting the schema is real and worth knowing before you do: nothing can be configured
over that collection until it has been fetched once.

Everything the host does with the answer — panels, the views it derives, the cross-source mapping
layer, per-panel refresh, and where compositions are persisted — is
[dashboards.md](../dashboards.md). A plugin needs none of it to provide a collection.

A `schedules` entry is the one descriptor that acts **when nobody is watching**. It names a route in
the plugin's own namespace, a cadence from the vocabulary in [schedules.md](../schedules.md), and an
optional timeout in seconds; the node's one scheduler POSTs `{ scheduleId }` to that route on that
cadence with no client open, and ignores the answer beyond ok/error — a schedule is not a data
channel. At most four, because a package with more than a handful of distinct periodic jobs is
describing a daemon and the daemon here is the node.

```json
{
  "contributions": {
    "schedules": [{
      "id": "refresh-mirror",
      "name": "Refresh issue mirror",
      "run": "/v2/p/linear/schedules/refresh-mirror",
      "cadence": { "every": 600 },
      "timeout": 120
    }]
  }
}
```

A manifest declaring one must declare a `node` half — only a node half serves that namespace, so a
client-only package's schedule would fire forever against a 404, and that is a parse error rather
than a run row that fails every hour. The cadence floor for a plugin is 300 seconds and is enforced
on read from the registry key, not restated in the manifest: below that a schedule is a poll, and
polling is a client's job for a person who is present.

It joins the trust dialog's **Declared** group — "Run *Refresh issue mirror* on the node every 10
minutes, with nobody watching" — and is recorded with the decision, so a version that moves from
daily to every five minutes reads as newly requested. Disclosure, not new capability: the run route
is one the plugin already owns and could already reach from any of its surfaces. What changes is
*when*, and that is exactly what the line says.

A compiled plugin has no manifest to declare from, so it registers node-side instead, in `init`:
`ctx.schedules.register({ scheduleId, name, cadence, timeout?, run })`, where `run` takes the run's
`AbortSignal`. Both feeders land on the same registry under the same `<pluginId>:<scheduleId>` key,
and the host owns removal — declaring the schedule *is* the lifecycle, so a `setInterval` in plugin
node code is a review flag. The lifecycle table (what survives a disable, an uninstall, a manifest
that drops an id) is in [schedules.md](../schedules.md).

One trap worth naming: a manifest-declared schedule on a dev-installed package needs the package
**rebuilt** before the node sees it. Reconciliation will not do it, and the symptom is a plugin that
reloads fine and schedules nothing.

Two smaller node-side registries follow the same two-feeders shape, and both exist so that something
can happen while nobody is watching (`docs/schedules.md`):

- **`ctx.collections.register({ collectionId, items })`** — where this plugin's collection can be
  read *from the node*. Not a second way to declare a collection: the client-side registration is
  still what puts one in a panel editor, and this is the pointer the measure sampler dispatches
  through. A loaded plugin registers nothing here; the host synthesises its entries from the
  manifest's `collections` descriptors, which already carry `items`.
`ctx.collections` is owner-bound by the host and cleared with everything else a plugin registered,
and it re-checks route confinement on every call rather than only at registration.

**Node actions have no `ctx` member.** Which of this plugin's actions a person may put on a schedule
is declared in the manifest, as a **command** whose verb is `runNodeAction`, and the host replays
that through a host-only seam (`HostPluginContext` in `server/pluginHost/types.ts`). Declaring nothing
means none of this plugin's actions can be scheduled, which is the right default for most of them;
an action that declares no `risk` is treated as `execute`, so the omission fails safe rather than
quiet. It sat on `NodePluginContext` until 2026-08-27, where it read as something an author writes,
and across 21 plugins nobody ever did.

A `themes` entry is the descriptor tier taken to its limit: a **colour** theme with no route, no
bundle and no CSS, declared as a map of the 22 palette tokens plus a `dark` flag. The host validates
the map and generates the `:root[data-theme="plugin:<id>:<theme>"]` block itself, so nothing a plugin
wrote is ever parsed as a stylesheet — which is why this seam needed no new trust boundary. A theme
cannot express shape, density or layout, cannot restate a derived token, and cannot set the three
self-description tokens (the host writes those from `dark`). Both ends validate: the node at parse
time so an author sees the error at install, the client again before generating CSS because a roster
row is bytes a node sent. The token contract, the value grammar and what happens to a stored
preference when the owning plugin disappears are in `docs/ui-design.md § Plugin themes`.

```json
{
  "contributions": {
    "themes": [{
      "id": "nightfall",
      "label": "Nightfall",
      "dark": true,
      "tokens": { "--bg": "#12121a", "--text": "#dcd7ff", "…": "…" }
    }]
  }
}
```


## The tree contract

What actually crosses the port, for anyone reading `packages/protocol/src/tree/` or writing a second
host. It is the tree half of the same story `frames/verbs.ts` tells for the bridge: one list both ends
compile against, and neither end may reach for the other's copy. Nothing in it names the DOM, which is
what lets a terminal renderer apply the same mutations to a cell buffer.

**A second host exists and does exactly that.** `acorn`, the terminal client
([tui.md](../tui.md)), applies these five mutations to cells (`apps/tui/src/plugins/TreeHost.tsx`). The rules are not written twice: the store,
the whole-batch pre-flight check, the prop sanitiser and the one place a handler id becomes a closure
are `packages/client-core/src/host/tree/treeState.ts`, which both hosts import, and each host owns only
its shell — a table of components per node name, a placeholder, and when a batch flushes. What differs
in the sandbox behind it is the realm and nothing else: a Web Worker under a CSP on the desktop, a
`node:worker_threads` thread under `--permission` in a terminal, the same two ports and the same
handshake either way (`docs/security.md § Rung 0 — The client sandbox`).

**A host's table maps a name to a component or to a loader.** A tree names types, so each host keeps a
table from a kit node name to the thing that draws it
(`packages/client-core/src/host/tree/components.ts`, `apps/tui/src/kit/components.tsx`). Cheap
primitives are the component; the heavy names — the diff viewer, the diff rows, `Markdown`, `Timeline`,
`ModelBackendPicker` — are a loader, because a table that holds every value puts every value in the
chunk that holds the table, and the DOM host's table is fetched on every cold window whether or not a
loaded plugin exists (`packages/client-core/src/host/tree/kitEntry.ts` says which and why). Each root
is drawn under a `Suspense` with a `null` fallback, so **a tree that names a heavy node draws nothing
for one frame and then draws it**. Nothing else changes: the mutations, the caps and the events below
are the same either way, and a plugin cannot tell which entry answered.

**A node is `{ id, type, props, children }`.** `type` is a kit node name. `id` is minted by the
sandbox adapter and is stable for the node's life; it is what events and patches address. `props` is a
plain object. Text is its own node (`#text`), never an attribute, so the wire has one node shape
rather than two.

**Five mutation kinds, in a coalesced batch** — per animation frame on the desktop, per timer turn in
a terminal, which is the host's decision rather than the protocol's: `insert(parent, index, node)`, `remove(id)`,
`patch(id, props)`, `move(id, parent, index)`, `text(id, value)`. `parent: null` addresses the slot's
root. A batch applies atomically or is dropped whole with a row on the plugin's page — half a batch is
a tree the sandbox never described.

The check that decides is a simulation: the host projects the batch against a copy of the parent map
and a child index built once, so an op is judged against the tree the ops before it in the same batch
would have left. A `remove` takes its whole subtree out of that projection by walking down the index,
which means a batch costs its own ops rather than the tree it is applied to — emptying a tree at the
5,000-node cap is 71 ms rather than the 1.1 seconds the earlier scan-every-node walk took
([performance.md](../performance.md) § The tree host's remove).

**Eleven events, host to sandbox**: `onPress`, `onChange` (the committed value), `onSubmit`,
`onSelect`, `onActivate`, `onToggle`, `onOpenChange`, `onExpand`, `onDismiss`, `onPick`, `onRemove`.
Never a key and never a pointer event, because a terminal host has neither and has to be able to map
its own keys onto these eleven names. A prop whose name is in the list carries a handler id; a prop
whose name starts with `on` and is not in the list is dropped.

**Lifecycle** is `tree:mount(slot, entry, props)` and `tree:unmount(slot)` from host to sandbox, with
`tree:ready`, `tree:batch` and `tree:failed` coming back, plus a ping. One worker serves many trees —
a tool card per call, a section per tray — so every message names its slot. A second `tree:mount` for
a slot already mounted is a props update, which keeps a tool card's redraw one message rather than a
teardown.

**One message expects an answer**: `tree:host-request(slot, id, op, name, payload)`, replied to with
`tree:host-reply(slot, id, ok, body | error)`. Two operations and no more — `owner.invoke` calls an
action the point's owner declared, `overlay.open` presents this contribution's companion overlay — and
neither is a dispatcher; [Asking the owner](cooperative-extension-points.md#asking-the-owner) has what each one grants. `id` is the
sandbox's own sequence and the host only quotes it back, exactly as the bridge's request ids work one
rung up. A payload or a reply body over 64 KiB is refused, eight may be outstanding per slot, and an
owner has ten seconds to answer. The failure arm is a code and a sentence, never a host stack.

The whole reason it rides here rather than the bridge is the slot. One worker holds one bridge, so a
request that crossed the bridge could not say which of a bundle's mounted trees sent it; a request that
crosses this channel is addressed by the port and the slot the host already trusts, and plugin code
supplies no identifier at all.

**Every message is validated**, because the host is the only thing between a stranger's code and the
shell's DOM:

- `type` has to be a node this build knows and can draw on this host. Anything else renders the
  labelled placeholder and records a roster row — the forward-compatibility rule applied to nodes.
- A prop value is a handler id or plain JSON, depth-bounded. `class`, `className`, `style` and
  `classList` are refused outright, a role prop carrying a raw colour is refused, and a function can
  never cross because a function is not JSON. A failing prop is dropped, the node still renders, and
  the row says which prop.
- Text is set as text. `Markdown` goes through the shell's own markdown policy. A `Button` carries a
  handler id, never a URL or a command id; navigation is `bridge.ui.openUrl`, held to the same rules
  as a frame's.
- **Caps**, in `TREE_LIMITS`: 1 MiB and 4,000 mutations per batch, 5,000 live nodes and 64 levels of
  depth per tree, 65,536 characters in one text node, 512 trees per worker. The byte cap is sized like
  the state channel's 1 MiB per value: generous for anything honest, small enough that a bundle cannot
  use the renderer as a memory bomb. Past a cap the batch is dropped and recorded.
- **Rate**: batches are coalesced per frame on the host side. A sandbox that floods is throttled, not
  trusted.

The version travels in the handshake (`TREE_PROTOCOL_VERSION`), and a mismatch is a placeholder rather
than a crash. `packages/protocol/src/tree/nodes.ts` carries the node names, the eleven events and the
role enums as plain constants with no Zod on them, because that file is bundled into a stranger's
plugin; `messages.ts` holds the schemas the host parses with. The lists are duplicated from
client-core's kit, which owns them, and a test over there fails the moment the two disagree.

The sandbox itself — one Web Worker per bundle, what it has and what it does not, and what happens
when it throws — is `docs/shell.md § The plugin worker`.

## One shared eligibility and trust check

Both registration passes (frames and chrome) need the same answer to "who may contribute, and what did
they declare": identity and trust. That answer used to be written out twice, in `frames/register.ts`
and `chrome/register.ts`, including a byte-identical task-pane predicate that feeds the `openPane`
allowlist, the list deciding which pane ids a sandboxed frame may ask the host to open. A security
check maintained in two copies, connected by nothing, fails silently in whichever direction an author
updates only one of them, and `tsc` stays quiet because each copy is locally consistent on its own.
`packages/client-core/src/host/plugins/contributions.ts` now owns that shared half; the passes keep their
own job, rendering a sandboxed iframe versus registering a command.

`eligiblePlugins()` returns one row per plugin id, and each row's `hash` and `trusted` come from the
same place: the bundle that **won fleet resolution**, not the first one a roster happened to list. In a
mixed-version fleet, node A might offer v1 while node B's v2 wins; taking the manifest from one row and
the hash from another would register contributions declared by bytes nobody accepted. A package with no
client half anywhere in the fleet never enters resolution, so it falls back to the first row seen; such
a package contributes only descriptors and host-drawn surfaces, whose behaviour does not depend on which
node described them. `trusted` is true only when the device has accepted the exact bytes that won
resolution, never the row's own claimed hash: a candidate dropped at resolution can still carry a
`client.hash` in its roster row, and honoring that would let an acceptance recorded against an older,
runnable build clear a bundle this device has already decided not to run.

Frames and chrome ask different-strength questions of the same row. Frames gate code-bearing surfaces
on `trusted` outright. Chrome asks the weaker `hasWithheldCode`: does this package carry code the device
has not been cleared to run? A descriptor-only package has no such code, so withholding its rail rows
and commands would hide a plugin that executes nothing.

`declaredSurfaces()` classifies a manifest's frames into three disjoint sets, kept apart because folding
them together would let `openPane` accept an id it must not: `panes` (task-scoped, the only surfaces a
task's layout can hold, and the `openPane` allowlist itself), `projectPanes` (a rail source's detail
view, addressed by URL rather than held in a task's layout), and `overlays` (full-screen pickers that
belong to no task at all). The task-scoped predicate is re-exported from
`@acorn/protocol/plugin/contract.ts` rather than written a third time here, because the node's manifest
parser checks the same thing when it validates that an `openPane` names a pane the manifest declares.
