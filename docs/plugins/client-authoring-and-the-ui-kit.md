# Client authoring and the UI kit

[Back to plugins](../plugins.md)

## Client authoring and the UI kit

The repository package builder applies one client transform, and it compiles for the tree path: the
Solid preset is told `generate: 'universal'` with `@acorn/plugin-api/ui/tree` as its module, so JSX
becomes acorn's own node names rather than DOM. A direct `solid-js` dependency is intentional and is
not the duplicate-Solid-in-one-realm hazard the shell dependency rules prevent: a frame's origin and
document are a separate reactive realm, and a tree's worker is a separate thread.

Each plugin used to name a `framework` key that the builder mapped to a transform. Phase 9 of the
layout programme deleted it, because the remote adapter is the only target and the key had one legal
value. A bundle drawing a rectangle is unaffected: it writes no JSX, so the transform has nothing to
rewrite, and a tree built through the SDK's own node functions rather than JSX is in the same
position.

A tree imports its nodes from `@acorn/plugin-api/ui/tree` and **must not** import
`@acorn/plugin-api/ui`: that barrel is components compiled for a document, and a tree bundle's own
preset would compile one into a tree of its own. A frame is the other way round — it imports the
components, as it always did. Either way the workspace dependency is the accepted intermediate
package location; the kit will be published separately for external plugins later, and only that
import name is expected to change. Do not copy the primitives or hand-roll replacements while
packaging catches up.

A tree needs none of this, and that is the point: the host draws the nodes, so the reader's theme,
style pack and density are already applied and there is nothing to bridge. What follows is the frame
path only.

The shell owns the frame document and links `/ui.css`, a stylesheet assembled at build time from
the same presentation-only primitive, tabs, picker, modal, copy, diff, and style-pack CSS the shell
uses. The appearance bridge applies the complete theme, style and invariant token projection to the
frame root. A frame may add its own CSS for its own markup, but it neither bundles nor versions a copy
of acorn's UI-kit CSS. A frame written without Solid can use the same emitted class contract without
sharing a JavaScript framework.

No plugin in this repository has a stylesheet, and an arch rule holds that: a plugin draws kit nodes,
which take no `class` and no `style`, and a plugin that ships CSS has written an element to hang it
on. Two more rules go with it. No plugin draws a raw `div` or `span`, checked by
`kit/lib/adoption.test.ts`, and no plugin mounts a Solid root of its own, because a root the host does not
know about sits outside every focus group and no intent reaches it.

Loaded-plugin commands and shortcuts are host-bound manifest data. A command id `search` becomes
`plugin.<plugin-id>.search`; plugin code cannot claim a first-party command id. `palette` controls
whether the command also appears in the palette (default `true`). A keybinding may target only a
command from the same manifest, uses the canonical `meta+ctrl+alt+shift+key` spelling, and must include
`meta`, `ctrl`, or `alt`:

```json
{
  "contributions": {
    "frames": [{ "target": "pane", "id": "editor", "label": "Editor" }],
    "commands": [{
      "id": "search",
      "title": "Editor: find in files",
      "category": "action",
      "palette": true,
      "action": { "verb": "openPane", "pane": "editor" }
    }],
    "keybindings": [{
      "command": "search",
      "defaultChord": "meta+shift+f",
      "when": "surface",
      "surface": "editor"
    }]
  }
}
```

`when` is `global`, `task`, or `surface`; loaded plugins cannot request `typing-exempt`. Command and
binding ids must remain stable across versions because the qualified binding id is the key in the
user's persisted override map.

The older `contributions.palette` array remains an alias for a command with `palette: true`, and it
never produces a second row. It survived the `10` bump on purpose: a removal is a major on its own
announcement, and folding it into a batch bought for something else would take it off manifests
written against a number that never said it was going. Nothing in the host branches on it — the
registration pass rewrites each entry into a command descriptor before anything else sees it — so it
costs one `flatMap` and no second code path.

### Command kinds

A command descriptor carries an optional `kind`. Omitted, or `action`, it is one closed verb the host
runs, which is what every command was before 2026-09-03 and what every already-installed manifest
still parses as. The other four are additive:

- **`group`** holds children and has no action of its own. Any command may name a `parentId`, which
  must be a group in the same manifest; cross-plugin parenting is refused, and a missing parent, a
  parent that is not a group, and a cycle are each an install-time error and a dropped command on the
  device.
- **`search`** names a GET `route` in the plugin's own namespace and one static `onSelect` verb. The
  host debounces the typing, sends `q` plus the identifier the declared `scope` owns
  (`taskId`, `projectId` or `workspaceId`), and renders
  `{ items: [{ id, title, subtitle?, icon?, badge?, ref?, taskId?, projectId?, workspaceId? }] }`.
  `placeholder`, `minQueryLength` (0–20) and `debounceMs` (150–1,000) are optional; the host caps the
  rendered set at 50 rows. `onSelect` takes a command's verbs plus `navigate`, which no other command
  may name: picking a row supplies the selected row, and a project-scoped search already ran against a
  routed project, so both halves of a project-surface address exist here. The path is minted from the
  pattern the host registered, with the row's own id as the item — a response still chooses nothing.
- **`input`** names a POST `route` and one static `onSuccess` verb. The host sends
  `{ input, taskId? }` when the reader presses Enter and expects `{ ok: true, item?, message? }`; a
  failure is the ordinary error envelope, keeps the reader's text on screen, and runs no action.
- **`setting`** names a GET `readRoute`, a PUT `writeRoute` and 2–32 static
  `{ value, label, keywords? }` choices. The host GETs the read route when the frame opens and PUTs
  the write route with `{ value, taskId?, projectId?, workspaceId? }` when a choice is picked; both
  answer `{ value }`. The value has to name one of the declared choices — the host checks its own copy
  on the way out and on the way back, so a route that starts answering with something new cannot add a
  choice nobody reviewed. Two choices spelled the same way is an install-time error. A Boolean is two
  choices, `On` and `Off`, not a toggle. Secrets and free-form values are not this variant: they need
  secure input, a reveal policy and recovery that a list of labelled choices does not have.

`scope` is `none`, `task`, `project`, `workspace` or `node` (the default). A command whose scope names
an identity the palette session does not have is not offered. `fleet` is not a scope a manifest may
name: fanning a plugin's route out over every paired node is not a decision a declaration makes for
somebody else's network.

A route's answer never chooses behaviour. Every field but the ones listed above is dropped before the
row is rendered, malformed rows are dropped individually, and the verb that runs when a row is picked
or a submission succeeds is the static one the manifest declared. A search, an input or a setting
needs a `node` entrypoint, because only a node half serves `/v2/p/<id>/`.

```json
{
  "contributions": {
    "commands": [
      { "id": "issues", "title": "Linear", "category": "navigation", "kind": "group" },
      {
        "id": "find",
        "title": "Linear: find an issue",
        "kind": "search",
        "parentId": "issues",
        "scope": "project",
        "route": "/v2/p/linear/issues/search",
        "placeholder": "Search issues…",
        "onSelect": { "verb": "navigate", "surface": "linear-issue" }
      },
      {
        "id": "grouping",
        "title": "Linear: group issues by",
        "kind": "setting",
        "parentId": "issues",
        "scope": "project",
        "readRoute": "/v2/p/linear/issues/grouping",
        "writeRoute": "/v2/p/linear/issues/grouping",
        "options": [
          { "value": "status", "label": "Status" },
          { "value": "assignee", "label": "Assignee" }
        ]
      }
    ]
  }
}
```

A compiled plugin declares the same five kinds as typed objects through `ctx.commands.register`,
which stamps the owner so a plugin cannot claim another contributor's group as a parent. Its `search`
gets a live callback rather than a route, so it may query whatever its client already has: a plugin
whose rows are on the device spreads `localSearch` from `@acorn/plugin-api/client` and gets one fetch
when the frame opens, no debounce and no minimum query; a plugin asking its node writes `query`
itself and keeps the defaults, because every keystroke is then a request. A `setting` shares the
reader and writer its Settings page already uses. The first-party catalogue is in
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md).

The webview manifest shape is:

```json
{
  "target": "webview",
  "id": "docs",
  "label": "Docs",
  "url": "https://docs.example.com/",
  "hosts": ["docs.example.com", "*.example.com"]
}
```

A project-scoped pane needs three entries that refer to each other, and all three are checked when the
manifest is parsed:

```json
{
  "contributions": {
    "frames": [{ "target": "pane", "id": "linear-issue", "label": "Linear issue", "scope": "project" }],
    "routes": [{
      "id": "linear.issue-route",
      "path": "/p/:projectId/x/linear/issues/:identifier",
      "surface": "linear-issue",
      "item": "identifier",
      "order": 60
    }],
    "sources": [{
      "id": "linear-issues",
      "label": "Linear",
      "order": 20,
      "items": "/v2/p/linear/rail-items",
      "onSelect": { "verb": "navigate", "surface": "linear-issue" }
    }]
  }
}
```

What the frame receives is unchanged: `bridge.context.projectId` and, when the URL addresses one,
`bridge.context.item`; every later selection arrives as a `select` message rather than a remount. A
project-scoped surface never gets a `taskId`, which is how a frame that draws both scopes tells them
apart without asking. Its `label` and `glyph` are currently unused — a task pane's label names its
switcher entry, but a project-scoped surface is drawn beside its own rail list, which already carries
the plugin's labels — so do not expect them on screen. The `x` segment is reserved by core for exactly this, and the prefix is derived
from the plugin id alone — a manifest cannot name it.

A source may instead offer a **panel area beside its list** — a dashboard the *user* composes, drawn by
the host with its own components, under constraints the source declares:

```json
{ "contributions": { "sources": [{
  "id": "linear-issues",
  "label": "Linear",
  "order": 20,
  "items": "/v2/p/linear/rail-items",
  "panels": { "fieldRole": "status", "views": ["list", "board"], "max": 6 }
}] } }
```

`panels: {}` is the whole opt-in and means this plugin's own collections, every view and four panels;
the block is the same one a `pane.aside` extension point takes, and
[dashboards.md](../dashboards.md) § Placements owns what it means. **Instead**, not as well: a source
declaring both `panels` and a `navigate` `onSelect` is a parse error, because the detail half of a
master/detail browse is drawn in exactly that rectangle. A source that declares neither is
pixel-identical to what it was before the key existed.

An `overlay` surface is a full-screen picker — the shape the editor's ⌘P file palette has as a compiled
contribution. The host draws the backdrop, the box, the title and the dismiss affordance; the frame draws
only its contents, because an iframe cannot position itself against anything outside its own rectangle
(the same argument that makes `refPanel` a frame target). It has no click site of its own, so the one
thing that opens it is the `openOverlay` verb, and a manifest declaring an overlay nothing opens is a
parse error rather than a surface nobody can reach:

```json
{
  "contributions": {
    "frames": [{ "target": "overlay", "id": "files", "label": "Go to file" }],
    "commands": [{
      "id": "open-files",
      "title": "Go to file",
      "action": { "verb": "openOverlay", "overlay": "files" }
    }],
    "keybindings": [{ "command": "open-files", "defaultChord": "meta+p", "when": "task" }]
  }
}
```

One overlay is on screen at a time — opening a second replaces the first, because two would leave the
reader unable to tell which one Escape dismissed. Escape and the close button are the host's; the frame
dismisses itself with `acorn.ui.close()` once its picker has picked, which is the one importer verb an
overlay also gets (`done`, the host's post-import refresh, stays importer-only). The overlay is bound to
the task that was active when it opened, so `bridge.context.taskId` is there for a picker whose job is
to put something into one.

A frame surface may also declare the modified chords its own UI handles:

```json
{
  "target": "pane",
  "id": "editor",
  "label": "Editor",
  "claimsKeys": ["meta+f", "meta+shift+f"]
}
```

The frame SDK begins with that declared set and `acorn.keys.claim([...])` may narrow it at runtime.
It cannot add undeclared keys. `meta+k`, `meta+,`, `meta+1`–`meta+9`, and `escape` are never claimable.
All other keydowns are forwarded to the shell's one dispatcher, so global and plugin-surface shortcuts
continue to work while the iframe has focus. Claims are disclosed in the device trust prompt and in
Settings → Shortcuts.

`urlSource` replaces `url` when the start URL is dynamic and must be inside the plugin's own
`/v2/p/<id>/` namespace; it answers `{ "url": "..." }` and receives task/project ids as query
parameters when present.

When a plugin has a client bundle, frames, webviews, and descriptors are gated on trust, per device and per
bundle: first sight of a `(plugin, hash)` pair prompts before anything registers, an update re-prompts
with the permission diff, and a rejected bundle gets neither frames nor chrome. A descriptor-only
plugin has no client bytes to trust and registers its data directly. The prompt renders the node-half
permissions, enforced UI scopes and key claims, and webview host grants as **three separate lists**. Webview hosts are
enforced but the remote page has live network access, so folding them into the networkless UI list
would be misleading. For the original two groups, only the second is enforced —
`packages/client-core/src/host/trust/permissions.ts` explains why they must never be merged, and it
classifies every line against what the host can actually grant rather than echoing manifest text.

Two behaviours that surprise authors, both deliberate: the `footer` slot is the **task** footer
(the slot `docker-footer-badge` occupies), so a badge is invisible until a task has a worktree; and
across a fleet exactly one bundle per plugin id is active — highest version at this plugin-API
major, chosen at boot and stable for the session — because contribution ids are un-namespaced
persisted layout keys and two versions registering at once would collide on them.

Client initialization for compiled-in plugins is synchronous registration. The host exposes contribution
points for panes, sources, settings pages, slots, extension points, extensions, provider reference
panels, agent contexts, schedules, persisted-state slices, Node statistics, attention
sources, brand marks, and content links. `slots` is one point for both shapes: the
slot id decides whether the component receives the shell context or only a task id (`docs/frontend.md §
Registries and plugins`). `schedules` is the same word the node half uses for the same idea, taking a
raw `intervalMs` because a renderer poll is not a node cadence (`docs/schedules.md § Cadence`).

`extensionPoints` and `extensions` are the compiled halves of the two manifest keys of the same name,
and the host stamps the same fields either way in: it mints `<pluginId>:<id>` for a point from the
plugin that registered it, and stamps `pluginId` on a contribution. A compiled contribution's carrier is
a `component`, which is the only one available to code already running in this process. See §
Cooperative extension points for the five kinds and for what the two render paths have in common.

`ctx.contribute(registry, entry)` is the escape hatch beside them, and the line it sits on is: a
registry the HOST owns gets a named member, and `contribute` is for a registry another PLUGIN
published. Core's own two targets, brand marks and content links, took names on 2026-08-27; before
that the line was drawn nowhere and every count of the contribution surface was two short. An activation pass handles subscriptions or local storage initialization after all descriptors
exist.

A contribution that names a provider must name its own plugin. `registries/extensionPoints/plugin.ts`'s
`declaredProvider` stamps `providerId` from the plugin that is activating, never from a value the
contribution itself carries, the same way a Node route is confined to its own path. Without it a
plugin could claim another plugin's integration rows, which is what `providerId` otherwise selects a
rail source on.

**`persistedStateSlices` has no manifest form, and will not get one.** A slice is not a value — it is a
`{ codec, empty, unknownIds, maxBytes, binding: { values, hydrate } }` record the host drives
through its own restore phases, reading and writing SHELL SIGNALS at boot before any frame exists, and
clearing them on scope eviction. None of that survives a port: a descriptor cannot hand over a codec, and
a frame is not mounted at the moment the phase it would belong to runs. A loaded plugin's answer is the
frame's `state.get`/`state.set` verbs into its own `plugin:<id>:*` namespace, which are the same prefs
the Node half's `prefs` facet reads — durable, per-node, capped at 1 MiB, and shared between a plugin's
two halves. What it costs is the orchestration: the frame reads its own state when it mounts instead of
being hydrated before first paint, and it clears its own keys instead of the host doing it on eviction.
That is a real difference and the reason the editor's open-file tabs cannot simply move as they are.

A source may also contribute routes. Two rules keep that seam honest. A route ADDRESSES an item inside a
surface — it must never gate whether the surface renders, because the rail selects a source by signal and
never navigates, so a render gated on a route match is unreachable. And a source scopes itself to the routed
project, rendering at core's `/p/:projectId` alongside every other source; its own paths hang below that
(`/p/:projectId/pulls/:number`, `/p/:projectId/issues/:identifier`). Core's URLs are constants in
client-core, not registry lookups, so a contributed route can never be resolved in core's place. The one
question core asks back is `SourceContribution.taskPath`: where a task the source owns should live.


## Task checks

A plugin that knows something about a task the owner is about to archive says so through a **task
check**, and that is the only way anything gets into the archive dialog.

```
GET  /v2/p/<id>/archive/check?taskId=…   → { concern } | { concern: null }
POST /v2/p/<id>/archive/apply            ← { taskId }
```

Two feeders, one registry, exactly like schedules and collections: a compiled plugin calls
`ctx.taskChecks.register({ id, check, apply? })`, a loaded one declares `contributions.taskChecks` in
its manifest and the host synthesises the same registration over the two routes above. Nothing
downstream can tell which one answered. The registry is
`packages/node-core/src/server/pluginHost/taskChecks.ts`; the dialog it feeds is
`packages/client-core/src/host/registries/shell/willPhase.tsx`.

A concern is plain data:

```ts
{ id, message, severity: 'warn' | 'danger', details?: string[], detailsMore?: number,
  action?: { label, checked } }
```

`details` is what the dialog lists under the message — changed paths, container names — capped at
five, with `detailsMore` counting what did not fit so the host draws "+7 more" and no plugin has to
invent that string. `action` draws a checkbox, and the cleanup behind it is `apply`, run by the
archive itself after the repo teardown script and **before the worktree is removed**, so a cleanup
that needs the worktree still has it.

There is no callback anywhere in that shape, and that is the design rather than an omission. The
action a concern offers is a route declared once — on the context or in the manifest — where the node
can confine it to the plugin's own namespace and re-confine it on every dispatch. An action arriving
inside a response body is an action nothing checked; the same rule
[extensionPoints.ts](../../packages/protocol/src/extensionPoints.ts) states for why an extension item
carries no per-item verb.

**What the host binds and a plugin cannot state:** the plugin id on every concern, the qualified id
`<pluginId>:<checkId>:<concernId>` the client hands back to name a cleanup, the route namespace, and
the deadlines. `severity` IS the plugin's to declare — unlike a context menu's absent `tone`, a plugin
saying "danger" is making that claim about its own data, not about a core resource.

**Every deadline is a race and not merely an abort.** The `AbortSignal` a check receives is a
courtesy: a check that watches it can stop early, and a check that ignores it — which is most of them
— would otherwise leave the dialog waiting forever. Two seconds for a check, because a person is
watching; sixty for a cleanup, because by then the dialog is gone. A check that is slow, throws, or
answers with something unusable contributes no row, which is also what a check that found nothing
contributes. A cleanup that fails names its plugin in the archive result: `ok` stays true, because the
task IS archived, and the owner is told what did not happen.

Declaring a check earns one line in the trust dialog, under `Declared` beside the schedules and for
the same honest reason — the host holds the confinement and the deadline, but what runs is the
plugin's own node code. `cleansUp` is part of the recorded grant, so a version that starts offering to
change something where it used to only warn reads as newly requested.

Four per plugin, the same ceiling as schedules. Both routes are confined to the plugin's own namespace
at manifest parse and again at every dispatch, and a manifest declaring a check with no `node` half is
a parse error rather than a check that 404s on every archive.

Three checks ship today: docker (running containers, with a `compose down` cleanup), changes
(uncommitted files, naming the first five paths — advisory, because committing or discarding on the
owner's behalf is exactly what a confirmation exists to avoid), and terminal (active sessions —
disclosure, since core stops them itself).

The client-side seam this replaced, `registerWillHandler`, is still on `@acorn/plugin-api/ui/host`
and is still what core uses for the two events that have no node meaning: the app quitting and a
workspace being removed. No plugin should use it. It hands the caller an unregister function nobody
was obliged to hold, and the one plugin that used it dropped the function, accumulated a handler on
every re-activation — twice per boot and once per node switch — and drew its warning twice.

## Harnesses

A plugin adds a managed agent — an ACP-speaking CLI acorn drives, with a full transcript, permission
prompts and plans — by declaring `contributions.harnesses`. It is the cheapest node-side contribution
there is: no route, no bundle, no build step.

The two-feeder pattern again, with one difference that matters. A compiled plugin registers a launch
spec directly with the driver registry in plugins/agents; a loaded one declares the harness in its
manifest and the host synthesises the registration through a host-only seam (`HostPluginContext` in
`server/pluginHost/types.ts`; there is no `ctx.harnesses` for a plugin to call). The difference is where
the registration lands: schedules, collections and task checks land in a node-core registry, and a harness
lands in **another plugin's**, through the `agents.harnessRegistry` capability that plugins/agents
publishes. The contract is `packages/node-core/src/server/pluginHost/harnesses.ts`, in node-core rather
than in the agents plugin because the host is what delivers a harness and neither package may import
the other.

The host does three things a plugin cannot do for itself, and nothing else:

- **Mints the id** as `<pluginId>:<harnessId>`, the same rule extension points follow. That value is
  persisted onto every session row, so a manifest must not be able to choose it.
- **Resolves an adapter entry** inside the contributing package, with the lexical and symlink
  confinement every manifest path gets. A descriptor whose entry escapes its package is dropped with a
  warning rather than failing the boot — it is one harness of a package that may contribute other
  things.
- **Turns a probe route into a call**, because a descriptor names a route and only the host can
  dispatch one with no client in sight. The answer arrives at plugins/agents as `unknown` and is parsed
  there: they are bytes a plugin wrote.

Resolved at delivery time and never cached. With agents disabled, a contributed harness is the same
silent nothing every unmatched contribution is, and re-enabling redelivers.

**A harness package with no node half still gets a plugin row.** This is the one place the loader
produces a plugin from a manifest alone (`server/plugins/loader.ts`): a no-op `init`, no storage, and
everything else a plugin row carries — a line in Settings → Plugins, an owner who can disable it, and
registrations that roll back with the rest. Delivering such a package beside the host instead would
mean reimplementing all of that. A manifest-only package may not take a built-in's id, because there
is nothing in it to run in that built-in's place.

The trust line sits under `Enforced`, not `Declared`, and it is the only line in that group that names
a program: the host spawns exactly the declared command with the declared arguments, and the plugin
never gets a process of its own. The grant key is the whole spawn plus the environment passthrough, so
swapping the binary, changing its arguments or widening a glob all read as newly requested.

A descriptor's `terminal.oneShot` block gets a second line, keyed on its own arguments. It is the one
argv a manifest may assemble: the arguments that make the CLI answer a single prompt and exit, which is
what puts the harness in every Generate control beside a connected API key
([integrations.md § Model providers](../integrations.md)). Two variables in fixed positions, the model
and the prompt, so there is nothing to substitute and nothing to branch on. `headlessArgv` and
`resumeArgv` stay code-only, because a manifest that can say "if resuming, add these two arguments" is
a template language.

Four per plugin, the same ceiling as schedules and task checks.
[managed-agents.md § Harnesses](../managed-agents.md) owns the behaviour and the two driver tiers;
[plugin-authoring.md § Harnesses](../plugin-authoring.md) is the authoring contract.
