# The manifest

[Back to plugin authoring](../plugin-authoring.md)

## The manifest

`packages/protocol/src/plugin/contract.ts` is the schema, declared once because the node parses it off
disk and the client registers contributions from the same shape. Its top-level keys:

| Key | Required | What it is |
| --- | --- | --- |
| `id` | yes | Matches `/^[a-z][a-z0-9-]{1,31}$/` — 2 to 32 characters, lowercase, no dots. The dot ban is what keeps `<dataRoot>/plugins/<id>/` and `<dataRoot>/plugins/<id>.sqlite` in one directory without colliding. |
| `name` | yes | Display name, 1–120 characters. |
| `version` | yes | Free-form string, 1–64 characters. Compared on update by the installer's downgrade guard. |
| `baseline` | yes | Exactly `"acorn-1"`. A missing or different marker is rejected before the plugin runs, including on an old API-1 package. |
| `apiVersion` | yes | A range over plugin API majors that has to cover this node's current major, `"2"` (`packages/protocol/src/plugin/apiVersion.ts`). Anything the range does not cover is a failed roster row with both versions in its reason. |
| `icon` / `icons` | no | One SVG path `d` string, or a map of them, authored in a 24×24 box. Not an SVG document — a document would mean `<script>`, `<use href>`, `on*` handlers and an allowlist parser, for a logo. Registered as `brand:<id>` and `brand:<id>/<key>` and nameable as any contribution's `glyph`. |
| `node` | no | Relative path to the ESM entrypoint the node imports. Omit it for a client-only or descriptor-only plugin. |
| `client` | no | Relative path to the single client file. Omit it for a plugin that ships only descriptors and document surfaces — it then has no bytes to trust and no trust prompt. |
| `migrations` | no | Relative path to the Drizzle chain. |
| `$schema` | no | Editor schema URL. The loader does not fetch it. |
| `emits` | defaulted | Up to 32 event declarations. Each names a `verb` and a `description`; consumers subscribe to `plugin:<id>:<verb>`. |
| `requires` | defaulted | What this package needs from the rest of the node. One key, `plugins`: up to 16 entries of `{ id }`, each optionally with a `version` range. See below. |
| `permissions` | defaulted | See below. Omitting it means an empty declaration, not a full one. |
| `contributions` | defaulted | See below. |

### Requiring another plugin

If your plugin consumes another plugin's capability, say so:

```json
"requires": { "plugins": [{ "id": "agents" }, { "id": "workflows", "version": "2 || 3" }] }
```

The node checks the list once every package on disk has been read, so the order the directories sort
in does not matter. A requirement is met by anything present under that id: a built-in, another
installed package, or a client-only one. A package whose requirement is not met does not load, and its
roster row says which id was missing rather than which capability was absent. A package that was
dropped cannot satisfy anyone either, so a chain of dependants comes down with it.

`version` is a range over the required plugin's **major**, in the same grammar as `apiVersion`: `"2"`,
`"2 || 3"`, `"1-3"`. Majors are all a dependant can reason about unless the two packages share a
release process, and a built-in has no version to range over at all, so a range against one is
ignored.

Two things the list also buys. A plugin initializes after the ones it names, so a capability
registered in the provider's `init` is there by the time yours runs. And a package cannot require
itself or name the same id twice, both of which fail the manifest with a reason.

What it does not do is install anything. There is no resolver and no registry to fetch from, so the
owner installs both packages and this checks their work.

All three path fields go through the same `entry` refinement: no leading `/`, no `..` segment. The
loader then re-resolves each one inside the package directory with lexical **and** symlink
confinement (`resolveInRoot`), so a path that was hostile from the start is rejected at parse time and
one that becomes hostile through a symlink is rejected at load time.

### What the builder normally supplies, and you now supply yourself

`apps/node/scripts/build-plugin.mjs` generates the manifest from a plugin's
`acorn-plugin.config.mjs`, filling in six fields the config never states. Hand-written, they are
yours:

| Field | Builder's value | Hand-written value |
| --- | --- | --- |
| `id` | the plugin's directory name in `plugins/` | write it, and make it match the plugin's `name` in code |
| `version` | read from the plugin's `package.json` | write it |
| `baseline` | imported from `ACORN_BASELINE` | write `"acorn-1"` |
| `apiVersion` | imported from `PLUGIN_API_MAJOR` | write the current major as a string, or a range covering it |
| `node` | `'./dist/node.js'` | your own relative path, e.g. `'./node/index.js'` |
| `client` | `'./dist/client.js'` when a client is declared | your own, e.g. `'./client.js'` |
| `migrations` | always `'./migrations'` in the built package | wherever your chain actually is |

The repository builder emits only the runtimes the config declares. A client-only plugin names
`client` and omits `entry`/`factory`; a descriptor-only plugin omits both. Removing a node entry also
removes the old `dist/node.js` rather than carrying executable bytes the next manifest no longer
names.

A Solid remote-tree client that uses the published SDK sets
`client.treeModule: 'acorn-plugin-sdk/remote'`. The builder then points the JSX transform at the same
runtime that the plugin imports. Repository plugins that omit `treeModule` retain the private
`@acorn/plugin-api/ui/tree` default.

Everything else in the generated manifest — `name`, `icon`, `icons`, `permissions`,
`contributions` — is copied through from the config untouched, so a `acorn-plugin.config.mjs` in the
repository is a faithful reference for what those blocks look like. `plugins/http/acorn-plugin.config.mjs`
is the widest one that owns tables; `plugins/model-providers/` is the narrowest (`contributions: {}`).

### Contributions

`contributions` is a loose object — a manifest written for a newer acorn contributes less on an older
one rather than failing to parse — with twenty-three named keys, each capped. The caps are not arbitrary:
each one is the point past which a contribution stops being an integration and starts being an app
inside someone else's chrome.

The rule that decides which key you want: **descriptors for facts, trees for UI, rectangles for
pixels.** Ask which of the three a surface is, in that order, and take the first that fits. A chip, a
badge, a menu row or a palette entry is a descriptor you declare and the host draws: it costs no
document, it looks native because it *is* the host's own components, and it stays live when nothing of
yours is mounted, because its data comes from a route on your always-running node half. A pane, a
panel body, a settings page or a card in somebody else's list is a tree. A frame is for pixels the
host cannot draw.

| Key | Cap | What it declares |
| --- | --- | --- |
| `frames` | 32 | A surface your client file draws: `pane` (task- or project-scoped), `refPanel`, `settings`, `importer`, `webview`, `overlay`, `coreSlot`. A `pane`, a `refPanel` and a `settings` surface **must** name a `layout` and its `regions`; a region is a tree (`{ "kind": "remote", "entry": "…" }`), a rectangle (`"frame"`), or a host-drawn document. A `list-detail` pane may set `collapsible: true`; loaded panes collapse to an empty rail with the host-owned expand control because their worker cannot read host collapse state to author compact rows. A task pane may set `showInSwitcher: false` when it is deliberately command-only; it remains a valid layout and `openPane` target. Set `readsArchived: true` only when a task pane reads stored history without a worktree and disables actions that would start work; the field opts the pane into the archived-task preview and its right rail. This is also where a pane declares `claimsKeys` and up to eight cooperative `destinations`, and where a `coreSlot` surface names the core surface that it offers to replace. A `settings` surface is placed by three optional keys, described under the table. |
| `sources` | 8 | A rail source. Rows come from a route on your node half; the host draws them and executes the `onSelect` verb. `showInRailByDefault: false` starts its icon hidden (see the settings keys under this table). |
| `slots` | 8 | A badge in an enumerated host slot: `footer` (the **task** footer, so it is invisible until a task is open) or `topbar` (the topbar's right end — the app's status bar). Nothing else is open, and `docs/plugins.md § Descriptors for facts, trees for UI, rectangles for pixels` records why each refused slot is refused. |
| `commands` | 32 | A command, id-qualified by the host to `plugin.<id>.<command>`. Each entry requires `kind`: an `action` with one narrow verb, a `group` that holds children, a `search` naming a GET route and one static `onSelect`, an `input` naming a POST route and one static `onSuccess`, or a `setting` naming a read route, a write route and 2-32 labelled choices. The `palette` flag on a command controls its visibility there. `docs/plugins.md § Command kinds` has the fields and bounds. |
| `keybindings` | 32 | A chord for a command from the same manifest. Canonical `meta+ctrl+alt+shift+key` order, must include `meta`, `ctrl` or `alt`, `when` is `global`/`task`/`surface`, and one binding per command. In the terminal client a terminal emulator keeps the command key for itself, so the host reads your `meta` as Ctrl: `meta+shift+p` is pressed there as Ctrl+Shift+P, and `meta+ctrl+alt+shift+d` as Ctrl+Option+Shift+D. You declare the chord once (`docs/tui.md` § What a plugin loses here). |
| `attention` | 4 | An attention-inbox feed, fetched per node from your route. |
| `nodeStats` | 4 | A node statistic, with a singular/plural label pair so a card reads "1 card stuck". |
| `contentLinks` | 16 | A bounded `https://` URL recogniser that delivers one captured segment to a task pane, your reference panel, or both. It must have at least one destination or the manifest is rejected. |
| `routes` | 8 | A renderer URL for a project-scoped pane, confined to `/p/:projectId/x/<id>/`. Eight, matching `sources`, because a route addresses something inside a surface a rail already reached. |
| `agentContexts` | 4 | An entry in the agent composer's context picker: an `options` GET and a `capture` POST. |
| `refResolvers` | 4 | A batch enrichment route so another plugin's surface can turn identifiers of your items into a label and a state chip. |
| `dataSources` | 32 | A Node-owned typed record source: `{ sourceId, name, singular, plural, identityScope, handler, icon?, providerId?, titlePointer?, urlPointer? }`. `handler` is a route on your own namespace that serves describe, options, query, and details operations. The host binds plugin identity, validates typed values and provenance, and gives dashboards and workflows the same runtime. See [Typed data sources](../data-sources.md). |
| `dataSourceDiscoveries` | 8 | A bounded source catalogue for provider resources that are not known at install time: `{ discoveryId, handler, providerId? }`. Discovery returns source descriptors; the host binds their handler, provider, plugin, and exact discovery scope. See [Typed data sources](../data-sources.md). |
| `themes` | 8 | A **colour** theme: `{ id, label, dark?, tokens }`, where `tokens` is the complete palette. You write no CSS — the host generates the block. See below. |
| `contextMenus` | 8 | A row on a host-drawn right-click menu: `{ id, location, label, icon?, order?, when?, action }`. `location` is from a closed list (`task.row` today); `when` is a map of literals that must all equal the target's facts; `action` takes the narrow verb set and receives the id of what was right-clicked. |
| `extensionPoints` | 4 | A place inside one of **your** surfaces that other plugins may fill: `{ id, label, kind, … }`. `kind` picks which of the five a point takes and which other fields it reads: `rows` and `annotation` take a `location` or a `key`, `remote` and `rectangle` take a `mode`, and `hook` takes a `payload` and an `allows` list. The host mints the id as `<yourId>:<pointId>`. You write no code for a `rows` or `annotation` point — the host draws it. |
| `schedules` | 4 | Work the node runs on a timer: `{ id, name, run, cadence, timeout? }`. `run` is a POST on your own namespace, called with `{ scheduleId }`, and its response is ignored beyond ok or error. `timeout` is seconds, defaulting to 60. The host mints the key from your plugin id, which is what opts the schedule into the 300-second plugin cadence floor. See `docs/schedules.md`. |
| `taskChecks` | 4 | What you have to say when the owner archives a task, and the cleanup you offer to do: `{ id, check, apply?, timeout? }`. `check` is a GET answering `{ concern }`; `apply` is a POST the archive runs if the owner leaves your checkbox ticked. See below. |
| `extensions` | 8 | What **you** bring to another plugin's point: `{ id, point, label, order?, … }`. `point` is `<ownerPluginId>:<pointId>`, and naming the owner out loud is the disclosure. Exactly one carrier says what you bring: `items` is a route on your own namespace, read with GET for rows and POST for annotations; `remote` is a key of the object your bundle passed to `mountTree`, for a tree; `frame` is an `inline` surface of yours, for a rectangle; `route` is a POST on your own namespace, for a hook handler. `items` and `route` require a `node` entry because only the node bundle can serve them. `matches` narrows a tree or a rectangle to the key values it draws, and `onSelect` takes the narrow verb set. |
| `auditActions` | 8 | A verb you write onto the node's audit trail: `{ id, label }`. The host qualifies it as `<yourId>:<id>` and refuses a `ctx.audit.record` naming one you did not declare, so the trail stays enumerable. Record what a person reviewing this machine would want to see, not every call you make. |
| `harnesses` | 4 | A managed agent acorn starts, drives and draws a transcript for: `{ id, label, glyph?, spawn, envPassthrough?, quirks?, probes?, terminal? }`. The only contribution that names a program acorn will run, and the only node-side one that needs no bundle at all. See [§ Harnesses](the-manifest.md#harnesses). |
| `customAgents` | 8 | A saved start for a managed session, listed under New beside the harnesses: `{ id, name, glyph?, description?, harness, options?, instructions?, maxToolRisk? }`. Data only, and the trust prompt shows the instructions in full. See [§ Custom agents](the-manifest.md#custom-agents). |
| `agentTools` | 16 | A task-scoped agent tool projected through the ordinary registry: `{ id, description, inputSchema, risk, handler, scope?, requiresSession?, timeoutMs?, maxOutputBytes? }`. `handler` must be in your own `/v1/p/<id>/` namespace. The host qualifies the runtime name as `<pluginId>_<id>`, validates the bounded JSON Schema at install and validates every call again. See [Agent tools](../agent-tools.md#loaded-manifest-carriers). |
| `contextSections` | 8 | Bounded reference data for the task prompt: `{ id, label, order, read, maxBytes, maxTokens, scope?, defaultIncluded?, timeoutMs? }`. `read` must be in your own namespace and answers the fixed host-owned response shape. See [Agent tools](../agent-tools.md#loaded-manifest-carriers). |
| `cliCommands` | 16 | Typed headless commands under `acorn plugin <id> <name>`. Each declares a name, title, summary, read/write risk, scope, required core capability, bounded object input/output schemas, and a relative `/cli/<name>` POST route. Writes also describe effects. See [CLI command authoring](./cli-commands.md). |

A settings page takes three optional keys that say where it sits and what it affects:

- `category` is the rail group: `general`, `agents`, `connections`, `features`, `automation`, or
  `machines`. Without one the page is filed under **Features**. The other three groups, Workspaces and
  projects, Plugins, and Advanced, hold acorn's own pages.
- `settingsScope` is what a change on the page affects, named in the page's header: `device`, `node`,
  `workspace`, or `project`. Without one it is `node`. A `workspace` or `project` page has no rail row
  of its own: it is a tab on every workspace's or project's settings page. A `project` page's binding
  carries that project's `projectId`, as a project pane's does.
- `glyph` is the page's icon, a Lucide name or a `brand:` mark, as on every other surface.

The compiled `SettingsContribution` spells the second and third `scope` and `icon`. The frame keeps
`settingsScope` because `scope` on a frame already means a pane's task or project scope, and a wider
enum there would make an older acorn refuse the whole manifest. `group` is still read: `workspace`
means `settingsScope: "workspace"`, and `general` means the defaults.

A value outside those lists does not drop the page. The page registers in its default place, and the
roster reports the key and its value as one this version of acorn does not recognise, the same way it
reports an unknown key ([forward compatibility](../plugins/forward-compatibility.md)). None of the
three needs a newer `apiVersion`: an older acorn strips the keys and reports them the same way.

Two more keys make the page findable from the settings search and the palette:

- `keywords` is up to 16 words someone might type that are not in the page's label, such as
  `["error tracking", "dsn"]`.
- `sections` is up to 16 `{ id, label, keywords? }`, one per `SettingsSection` your tree draws, in the
  order it draws them. Each is a search result reading **Page › Section** and a deep link,
  `settings/<page id>#<section id>`, that scrolls to the section and marks it. `id` is letters, digits,
  `.`, `_`, and `-`, and must match the `id` of the `SettingsSection` in your tree.

```js
frames: [{
  target: 'settings', id: 'sentry-telemetry', label: 'Sentry export', category: 'machines',
  keywords: ['error tracking', 'dsn'],
  sections: [{ id: 'export', label: 'What to send', keywords: ['sample rate'] }],
  layout: 'single', regions: { body: { kind: 'remote', entry: 'settings' } },
}]
```

A compiled page's `sections` also take `rows`, the labels of the rows in each section, which search
ranks between section names and keywords. A manifest has no `rows`: an index built from what a
sandboxed tree draws would have to read the tree. A list past its limit costs the page its search
entries, never the page, and the roster reports it. Neither key needs a newer `apiVersion`.

The two kit nodes a settings page is drawn with, `SettingsSection` and `SettingRow`, are different: a
tree that names them on an acorn that predates them draws the labelled placeholder any unknown node
draws. Raise the floor of your `apiVersion` range to the release that has them if you use them
([docs/frontend.md](../frontend.md) § Pages and the save model).

A settings page's header names the node its body reads. A frame always reads the active node, so its
header names that node as plain text rather than offering the node switcher core's own node pages use.

acorn draws a plugin strip above your page: your plugin's name and origin, **Manage plugin**, the
**Enabled** switch, and a line when the plugin is off, waiting for approval, failed, or offline. Don't draw
your own enable switch or status line. To put the **Show in left rail** switch for one of your sources
there, name it in `railSourceVisibility`. The host draws the switch and keeps the preference, so your
tree never reads or writes it:

```js
sources: [{ id: 'board', label: 'Board', glyph: 'layout-dashboard', order: 50, items: '/v1/p/board/items', showInRailByDefault: false }],
frames: [{
  target: 'settings', id: 'board-settings', label: 'Board', railSourceVisibility: ['board'],
  layout: 'single', regions: { body: { kind: 'remote', entry: 'settings' } },
}]
```

- `showInRailByDefault: false` on a source starts its icon hidden. The source still registers, its
  commands and panes still work, and the palette offers **Open <label>** for it. The person's own choice
  wins over the default. Absent means shown.
- `railSourceVisibility` lists up to 16 of your own source ids. An id that names a core source or another
  plugin's is reported in the roster's `unknown` list, as
  `contributions.frames.<id>.railSourceVisibility: '<source>' is not one of this plugin's sources`, and
  gets no switch. The page stays. A compiled page that names one throws when its plugin registers.
- A source id is the key the person's choice is stored under, so keep it stable across releases.
- Without `railSourceVisibility`, the switch is still under **Settings > Plugins > Rail and surfaces**.

Neither key needs a newer `apiVersion`: an older acorn strips both and shows the icon.

A theme is the one contribution with no route and no bundle behind it, so it is the cheapest thing a
plugin can be. `tokens` must carry **exactly** the palette token names and nothing else: a missing one,
an unknown one, a derived one (`--danger`, `--surface-sunken` — those are `var()` references the host
declares once) or a style-axis one (`--radius`) all fail the parse. Values are a hex colour or a flat
colour function — `#1e1e2e`, `rgba(0, 0, 0, 0.42)`, `oklch(0.7 0.15 250)`; named colours, `var()` and
nested functions are refused. `dark: true` is how a theme says it is dark, and the host writes
`--is-dark` and `--color-scheme` from it — never try to set those two. The result is
selectable in Settings → Appearance as `plugin:<your-id>:<theme-id>`, and falls back to the built-in
default whenever your package is not there. **Call `plugin_authoring` for the current token list** — it
is read off this node's own schema, and getting one name wrong means the manifest does not parse.
Style packs (shape, density, typography) are not contributable; see `docs/ui-design.md`.

A `contextMenus` entry is the other contribution with a vocabulary you cannot guess at. `location` is
a closed list — **call `plugin_authoring` for the current one** — and a location this node does not
have is a parse error rather than a row that never appears. `when` is a map, not an expression: every
named fact must be strictly equal to the target's own, so `{ "origin": "github", "pinned": true }`
means both, and `{ "pinned": "true" }` matches nothing because a string is not a boolean. Naming a fact
the location does not supply is refused too, for the same reason as an unknown location. Your row lands
in the same menu core's rows come from, after them by default (order 500 against core's 10/20/30), and
its id is namespaced to `plugin:<your-id>:<row-id>` by the host so it cannot displace one of them.

The two cross-plugin keys are the third vocabulary you cannot guess at, and they are two halves of one
thing: `extensionPoints` is you opening a list to others, `extensions` is you filling somebody else's.
Both are manifest keys, both are shown in the trust prompt, and **there is no third way** — nothing lets
you touch a plugin that did not declare a point, and nothing lets your code run inside another plugin's
realm. What crosses is a descriptor: your `items` route answers
`{ items: [{ id, title, subtitle?, icon?, badge? }] }`, the host draws those rows with its own
components and stamps your plugin id beside them, and your one declared `onSelect` receives the clicked
row's id. A contribution to a point that is not there — owner not installed, disabled, or it dropped
the point in an update — delivers nothing, silently; that is the designed outcome, not a failure to
chase. **Call `plugin_authoring` for the current location list.**

#### Add task annotations

Use the core-owned `core:task` annotation point to publish loaded-plugin status on task rows. This
complete manifest has a node bundle and one route-backed extension:

```json
{
  "id": "deploy-status",
  "name": "Deploy status",
  "version": "1.0.0",
  "baseline": "acorn-1",
  "apiVersion": "2",
  "node": "./node.js",
  "contributions": {
    "extensions": [
      {
        "id": "task-deployments",
        "point": "core:task",
        "label": "Deployments",
        "items": "/v1/p/deploy-status/task-annotations"
      }
    ]
  }
}
```

The node route receives the visible task ids in one POST. Return only marks for keys that you know:

```js
const deployments = new Map([
  ['task-123', { failed: false }],
  ['task-456', { failed: true }],
])

export default {
  name: 'deploy-status',
  init(ctx) {
    ctx.routes.fetch(async (request) => {
      const url = new URL(request.url)
      if (request.method !== 'POST' || url.pathname !== '/task-annotations') {
        return new Response('Not found', { status: 404 })
      }

      const body = await request.json()
      const keys = Array.isArray(body.keys) ? body.keys : []
      const items = keys.flatMap((key) => {
        if (!key || typeof key.task !== 'string') return []
        const deployment = deployments.get(key.task)
        if (!deployment) return []
        return [{
          key: { task: key.task },
          severity: deployment.failed ? 'danger' : 'info',
          text: deployment.failed ? 'Deployment failed' : 'Deployment is live',
          icon: deployment.failed ? 'circle-alert' : 'rocket',
        }]
      })
      return Response.json({ items })
    })
  },
}
```

`core:task` keys contain one scalar string field, `task`. A mark contains that key, an `info`, `warn`,
or `danger` severity, text that the host caps at 200 characters, and an optional Lucide or `brand:`
icon name that the host resolves. It contains no JSX, CSS, geometry, color, or action. The host stamps
your plugin id as provenance, accepts at most 256 valid marks from this contributor and request, and
draws them through its own desktop and terminal rail projections. The generic annotation transport
inspects at most 4,096 raw rows before the point-specific limit. Malformed rows are dropped
independently.

For request identity, freshness, cancellation, and failure isolation, see
[Task annotations](../plugins/cooperative-extension-points.md#task-annotations).

The node requirement applies only to the route-backed `items` and `route` carriers. `remote` and
`frame` keep their client-bundle checks, and a descriptor-only harness can still omit `node` unless it
declares a probe route.

A `coreSlot` surface is the related pattern for acorn's *own* surfaces:
`{ target: "coreSlot", id, label, coreSlot }` plus a client bundle. The designated surfaces are
`rail.taskList`, `pane.switcher`, `rail`, and `topbar`. The last three require a `single` layout with
one remote-tree `body`; the host gives that tree data and named actions. A rail or topbar tree can
place its one nested host slot with the `Slot` node and the `slotRef` in its props. Declare
`placesSlots: ["rail.taskList"]` or `["topbar.right"]` when you place it; Settings warns when the
declaration is absent. Declaring a replacement **seizes nothing** — the user picks the provider in
**Settings > Plugins > Rail and surfaces**, and acorn draws its own again when your plugin is disabled or its surface fails.
It is not a pane, so no pane verb can name it.

A `taskChecks` entry is the one contribution that runs when a person is about to lose something.
Archiving a task removes its worktree, so the host asks every plugin first and draws the answers in one
dialog. Your `check` route is called with `?taskId=`, and answers either `{ concern: null }` — the
common case, which must stay cheap — or:

```json
{ "concern": { "id": "containers", "severity": "warn",
               "message": "8 running containers are linked to this task",
               "details": ["api", "db", "worker"], "detailsMore": 5,
               "action": { "label": "Also stop its containers", "checked": true } } }
```

`details` is drawn as a list under the message, capped at five, with `detailsMore` counting what did
not fit so the host writes "+5 more" for you. `action` draws a checkbox, and if it is still ticked when
the owner confirms, the host POSTs `{ taskId }` to your `apply` — while the worktree still exists, so
a cleanup that needs it has it. Declare no `apply` and no checkbox is drawn, whatever your answer says:
that is the advisory mode, and it is the right one for anything you should not do on someone's behalf.

Three deadlines to write against. Your check has **two seconds**, because a person is watching a
dialog; your cleanup has sixty. Both `AbortSignal`s are a courtesy, not a leash — the host stops
waiting either way, so a check that wants to be included has to be quick rather than merely
interruptible. A check that is slow, throws, or answers with something the host cannot draw
contributes no row, exactly like one that found nothing; the archive is never blocked by your plugin
being broken.

Both routes are confined like every other, and both are shown in the trust prompt — the second line
says you offer to clean up, so a version that starts changing something where it used to only warn
reads as newly requested.

Every path in every descriptor is confined at parse time to `/v1/p/<id>/`, the plugin's own
namespace. `server/plugins/manifestValidation/references.ts` checks this after the field schema
parses, because confinement needs the manifest's `id`. The frame bridge applies the matching rule
at runtime.

The cross-field rules are worth knowing before you write a manifest that parses and then does nothing:
an `openPane` must name a task-scoped pane this manifest declares; a `navigate` must name a
project-scoped one; a project-scoped pane needs both a `routes` entry (its only address) and a source
whose `onSelect` navigates to it (its only mount site); an `overlay` needs an action that opens it; a
`surfaceAction` may name only a pane that draws a region of its own, as an iframe or as a worker
tree; a webview needs a client bundle; an
extension point must hang off a `pane` this manifest declares and only one may sit at each location on
it; an `extensions` entry's `point` must be a `<pluginId>:<pointId>` reference, its `items` or `route`
path must be your own, and either route-backed carrier requires a `node` half; a `taskChecks` entry
needs a `node` half, since only that serves the namespace its two
routes live in; a `harnesses` entry's `spawn` must name exactly one of `command` and `entry`, may only
carry `requires` beside an `entry`, and needs a `node` half if it declares any `probes`; a `coreSlot`
surface needs both a designated slot name and a client bundle; and no id may repeat across
contributions.

### Harnesses

A harness is a managed agent: acorn starts it, drives the session, and draws the transcript, the
permission prompts, the plans and the config options you see in the Agent pane. Every agent that
speaks the [Agent Client Protocol](https://agentclientprotocol.com) is one manifest away, because
acorn already owns everything downstream of the wire. That includes new-session defaults: whatever
config options your harness advertises are remembered and re-applied to the owner's next session with
no work on your side. For more information, see
[New-session defaults](../managed-agents.md#new-session-defaults).

This is the whole plugin that adds OpenCode:

```json
{
  "id": "opencode",
  "name": "OpenCode",
  "version": "1.0.0",
  "baseline": "acorn-1",
  "apiVersion": "2",
  "icon": { "d": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" },
  "contributions": {
    "harnesses": [
      {
        "id": "opencode",
        "label": "OpenCode",
        "spawn": { "command": "opencode", "args": ["acp"] },
        "envPassthrough": ["OPENCODE_*"],
        "quirks": { "manualCompaction": true },
        "terminal": { "command": "opencode" },
        "oneShot": { "args": ["run"], "modelFlag": "--model", "output": "text" }
      }
    ]
  }
}
```

One manifest and one icon path. No node bundle, no client bundle, no build step, and no `exec` grant:
you describe a spawn, and the agents plugin owns the child process. Install it like any other package,
approve the two lines the trust prompt shows, and OpenCode appears beside Claude and Codex in the Agent
pane, in a task terminal, and in every Generate control in acorn.

The runtime id is `opencode:opencode`: the host prefixes your harness id with your plugin id, the same
minting rule extension points follow, and for the same reason — a manifest may not claim a name in
someone else's space. That id is persisted into session rows and workflow steps, so renaming it is a
compatibility break for your users rather than a label edit.

**What you declare, and what acorn does.**

| You declare | acorn does |
| --- | --- |
| `spawn` | Starts the agent, owns the child, and restarts and shuts it down in the documented order |
| `envPassthrough` | Builds the child environment through the broker contract; credentials never pass through |
| `label`, `glyph` | Every surface: Agent Center rows, the pane header, usage sections, notifications |
| `quirks` | Enables or hides the matching affordance, per harness |
| `terminal` | Registers the terminal profile: task terminals, handoff, the input-controller lease |
| `oneShot` | Lists your agent in every Generate control, and runs one contained turn when it is picked |
| `probes` | Fetches them and draws the answers |
| nothing else | The ACP connection, the normalizer, the durable event ledger, transcript rendering, permission plumbing, attachments, session persistence, reconnect, replay |

If you find yourself writing code to add a harness, either the agent does not speak ACP — in which
case this contract does not cover it — or the seam has a gap, which is a bug report.

**The two spawn forms.** `spawn` takes exactly one of:

- **`command`** — an executable on `PATH`, with `args`. The common case: `opencode acp`,
  `gemini --experimental-acp`. The user installs the CLI; your harness's diagnostics say so when it is
  missing.
- **`entry`** — a package-relative JavaScript file, run with the node service's own binary. This is
  how you ship an adapter for an agent that does not speak ACP natively, the same way acorn's own
  Claude harness runs a packaged adapter. Add `requires: { command, env }` and acorn resolves that CLI
  on `PATH` and hands the child its absolute path under the variable you named — which is what an
  adapter needs and the reason there is no template language here.

An `entry` is your code running in a child process. Less privileged than a node bundle, since it is
not inside the node, but still code, and the trust prompt says so.

The ACP project publishes a registry of each agent's launch arguments at
`cdn.agentclientprotocol.com/registry/v1/latest`. Copy yours from there. acorn never fetches it at
runtime: your manifest is the pinned truth, so launch arguments change by plugin update and the trust
record sees it.

**Quirks.** ACP does not carry everything every vendor can do, and the gap is closed by declaration
rather than by a list of ids inside acorn:

- `manualCompaction` — the agent implements a compaction command, so the pane offers Compact.
- `sessionPersistence` — sessions outlive the agent process, so the terminal handoff exists. You do not
  need it for acorn to pick a session back up after a restart: if your agent advertises `session/load`
  or `session/resume`, the driver finds that at `initialize` and uses it.

Do not restate anything the agent already says through ACP capability negotiation. The driver reads
those off the wire, and a manifest repeating them would only drift.

**Probes.** Two optional GETs on your own node half, which means adding a `node` entry:

- `probes.usage` answers `{ plan?, quotas: [{ id, label, percentRemaining, resetsAt?, resetText? }], account? }`.
  Use `session` as a quota id for the one the compact indicator shows. acorn derives the health and the
  capture time, so one harness cannot call 5% remaining healthy while another calls it critical. Without
  this route your harness simply shows no usage section, which is the right answer for most agent CLIs.
- `probes.auth` answers `{ authenticated: boolean | null, diagnostic? }`, for the Agent Center's
  provider-health row. `null` means "cannot tell", which is different from `false`; an answer acorn
  cannot read is treated as `null` rather than as signed out.

**One-shot text generation.** `oneShot` describes how your CLI answers a single prompt and exits.
Declare it and your agent appears in every Generate control in acorn — the commit message wand, the
SQL draft, the workflow definition generator — beside whatever API keys the owner has connected.

It sits beside `terminal` rather than inside it, because holding a conversation and answering one
question are two different things and some agents do only one. DeepSeek is the second kind:
`dsh --profile headless "…"` answers and exits, and `dsh` on its own has no interactive mode, so it
declares `oneShot` and no `terminal`. Then it is in the Generate lists and not in the terminal menu,
which is the truth about it. Four fields:

- `command` — the executable, for a harness with no `terminal` to borrow one from. Leave it out
  whenever there is a `terminal`, because a harness runs one binary and acorn decides whether it is
  installed by looking that one up on `PATH`. Naming a second one is refused rather than resolved.
- `args` (required) — the subcommand and switches for one prompt in, one answer out. `["run"]` for
  OpenCode.
- `modelFlag` — the flag a model id goes behind, in your CLI's own spelling. OpenCode wants
  `--model` and reads `provider/model`. Leave it out and your CLI answers on whatever model it is
  configured with.
- `output` (required) — `text` if your CLI prints the answer on stdout, `json-lines` if it writes a
  newline-delimited stream with a `result` event in it, which is the shape
  `claude -p --output-format stream-json` writes. There is no default: guess wrong and every generate
  fails as unreadable output.

acorn builds the argv in fixed positions: your `args`, then `modelFlag` and the model when a caller
names one, then the prompt last. A system prompt is prepended to that prompt with a blank line between,
because a manifest has no way to name a system-prompt flag.

That is the whole language, and it stays that way. There are no placeholders, no `${prompt}`, and no
per-argument conditions, because a manifest that can say "if resuming, add these two arguments" is a
template language nobody can hold in their head. A CLI that wants the prompt in the middle, or a flag
whose value depends on another flag, needs a code-tier profile instead.

Two things to check before you pick `output`. Run your CLI with its stdout on a pipe rather than a
terminal, because plenty of them print differently to each: `opencode run` sends its `> agent · model`
header, tool lines and permission prompts to stderr and only the assistant's text to stdout, which is
what makes `text` right for it. Then look for a terminating event if you were reaching for
`json-lines`: `opencode run --format json` emits `step_start`, `text`, `tool_use` and `step_finish`
lines with no `result` among them, so acorn would read the answer as missing.

The generate runs contained, and none of it is yours to arrange: an empty temporary directory, so your
CLI does not read a repository's `AGENTS.md` in front of the caller's prompt; no acorn token and no MCP
server in the child, so there is nothing for a tool to call; a 60-second ceiling; and an environment
with no key acorn holds anywhere in it, so your CLI authenticates with its own stored login. The trust
prompt names the invocation on its own line, because it is a second program run with different
arguments: "Runs `opencode run --model MODEL` to generate text". Change those arguments in a later
version and the owner is asked again.

**What a data-only harness does not get.** Headless and agentic workflow steps. Turning conditional
argv assembly into manifest data means inventing an argv template language, and that is the flexibility
this contract refuses in favour of something a person can hold in their head. A data-only harness works
in the Agent pane, the terminal and the Generate lists; a workflow's agent step cannot name it. A
workflow `decide` step can, but it needs a JSON verdict back and a manifest cannot ask your CLI for
one, so a `text` harness will answer prose and the step will fail. A harness that needs either is asking
for first-party investment, not a bigger manifest.

### Custom agents

A custom agent is a harness with the settings, instructions, and tool access a session should start
on. The owner makes their own under Settings > Custom agents, and a plugin can ship some. Each one is
listed under **New** in the Agent pane and in the command palette, and another agent can start it by
name through `agent_spawn`. For more information, see
[Custom agents](../managed-agents.md#custom-agents).

```json
{
  "contributions": {
    "customAgents": [
      {
        "id": "reviewer",
        "name": "Bug reviewer",
        "harness": "codex",
        "options": { "reasoning": "high" },
        "instructions": "Review the change for correctness. Report each bug with its file and line.",
        "maxToolRisk": "read"
      }
    ]
  }
}
```

The host mints the id as `<yourId>:<id>`, and it is copied onto every session started from the agent.
`harness` is `claude`, `codex`, another plugin's `<pluginId>:<harnessId>`, or the bare id of a harness
this same manifest declares, which the host qualifies for you. `options` is provider option id to value,
as the harness advertises them. A value the harness does not offer is dropped when the session starts,
with a line in the transcript, so the session still runs. `maxToolRisk` narrows acorn's own tools and
never widens them.

`instructions` go into the system prompt of every session an owner starts from the agent, on Claude Code
and Codex, and in front of the first message on any other harness. That makes them the grant: the trust
prompt shows the full text, and a version that changes it asks again. An agent cannot bring a tool
server, because a server is a program to run. Declare `agentTools` for that.

A package made of nothing but harnesses and custom agents needs no bundle at all. The owner sees it in
**Settings > Plugins > Installed** and can turn it off, which takes its agents out of New. The owner cannot edit a
plugin's agent, only duplicate it into one of their own.

### The action verbs

Descriptors do not run plugin code. They hand the host a verb from a closed set, and the host executes
it. Closed is the point: every plugin composes the same few verbs, and adding one later is additive
where removing one would not be.

The full set. It is meant for a rail source's `onSelect` — the one click site that has a selected row,
a routed project and the host's promotion callback in scope. A `search` command's `onSelect` gets the
narrow set plus `navigate`, because it has both halves of a project-surface address too.

| Verb | Effect |
| --- | --- |
| `openPane` | Push a task-scoped pane from this manifest into the active task's layout, carrying the clicked row's id as a pane intent. |
| `openTask` | Go to the task the row names, and stop. For a row whose subject *is* a task, where picking a pane on the reader's behalf would be `openPane` wearing another name. A row that names no task gets a toast saying so. |
| `navigate` | Change the URL to the route this manifest declared for a project-scoped pane, with the selected row as the addressed item. |
| `runNodeAction` | POST to a path inside `/v1/p/<id>/`. |
| `createTask` | Host-owned promotion: the row supplies the task seed, the host owns the modal, the ownership check and the ordering. |
| `openUrl` | `https` only, in the real browser. |
| `openOverlay` | Open a full-screen picker this manifest declares. |
| `surfaceAction` | Deliver this command's own id to a region of one of your own panes — an iframe or a worker tree. The only verb whose effect lands inside a plugin. |

Commands, slot badges and a source's `emptyState` take a **six-verb subset**: `openPane`, `openTask`,
`runNodeAction`, `openUrl`, `openOverlay`, `surfaceAction`. `createTask` and `navigate` are absent
because they need a selected row and a routed project respectively, and a command registry row has
neither. A verb that parses and can then only fail is worse for an author than one the manifest
refuses.

### Permissions

Three groups, enforced at the boundary that owns each one.

`permissions.node` shapes both the RPC `ctx` your node half receives
(`server/plugins/permissions.ts`) and its permission-scoped worker realm. Gating is by omission: an
undeclared host facet is absent, so the first call is a `TypeError` the author sees immediately.
Filesystem, environment, process, and network grants are also absent unless declared.

- `core`: `fs`, `git`, `tasks`, `context`, `models`, `identity`, `prefs`, `telemetry`,
  `data:query`, `data:write`, plus
  `projects:read`, `projects:config`, `projects:write`. The project grants nest — `config` and
  `write` each imply `read` — and they are split because `checkouts()` returns where every codebase
  on the machine lives, and `config()` returns shell commands the node executes. An unknown token is
  skipped, not rejected: a manifest naming a facet from a newer build should lose that one grant.
- `capabilities`: capability ids this plugin may `get`/`require`. `provide` is never filtered —
  exporting a capability is a contribution, not an access grant.
- `secrets` / `exec`: booleans, separate from `core` because they are the two asks a reviewer should
  have to see spelled out.
- `net`: exact hostnames or `*.domain` patterns that the worker's `fetch` may reach. A pattern
  matches one subdomain label, not the parent domain or deeper subdomains. `'*'` grants access to
  any hostname, permits redirects, and appears as broad network access in the permission prompt.
  Raw network modules stay unavailable unless `sockets` is also granted. With a host-scoped grant,
  redirects are returned rather than followed so fetching the next location rechecks its host.
- `sockets`: unrestricted raw socket access for protocols that cannot use the hostname-scoped fetch
  broker. This broad, high-risk grant has no hostname allowlist.
- `env`: parent-environment variable names the worker may inherit in addition to the process broker's
  credential-free base. Each is a high-risk trust line.
- `files`: local path grants resolved from environment variables, as
  `{ "env": "MY_PLUGIN_FILE", "access": "read" | "read-write" }`. The value must be absolute and
  outside acorn's data root. A read-write grant includes one fixed `.acorn-tmp` sidecar so an author
  can replace the file atomically without receiving its whole directory.

**`telemetry` is the one grant that hands you other packages' data.** It gives you
`ctx.core.telemetry.onBatch`, and a sink sees every record this node collects from every owner:
core's request timings, another plugin's schedule and hook runs, and the log lines of packages the
owner installed for a different reason. The trust prompt says exactly that, and draws it high:
"Read this node's telemetry: request timings, schedule and hook runs, logs, and error names from
every plugin". Writing telemetry about your own work needs nothing (§ Telemetry and logging).

```json
{ "permissions": { "node": { "core": ["telemetry"] } } }
```

```js
export function init(ctx) {
  ctx.core.telemetry.onBatch((batch) => queue.push(batch))
}
```

Return quickly. The collector calls sinks on a timer, awaits none of them and contains a throw, so
buffering, retry and sampling are yours ([telemetry.md](../telemetry.md) § Writing a sink).

A telemetry sink can check `ctx.core.telemetry.enabled()` before retrying a queued export. It reports
the collector’s node consent, updated within five seconds, and needs the same `telemetry` permission
as `onBatch`. Do not read `telemetry.enabled` through `ctx.core.prefs`: those keys are scoped to the
plugin’s own namespace.

**`models` is one token, and it does not choose what gets spent.** The trust prompt reads "Generate
text with your model providers and installed agent CLIs", because the list your picker draws holds
both: a connected OpenAI or Anthropic key, and any agent CLI on the machine that declares a one-shot
text mode ([integrations.md](../integrations.md) § Model providers). Which of them runs is decided by
the person picking from the dropdown, or by your own fallback to the first available backend. You
cannot name a CLI the owner does not have, and you cannot make one run with tools or inside a
worktree, because core owns that process. There is no second token for the CLI half: `models` is the
host operation being granted, whichever host-owned backend the person later chooses.

**Database access is host-mediated.** `data:query` supplies `ctx.core.data`: connect or disconnect a
task's configured PostgreSQL source, inspect its catalog or configured schema description, and run a
bounded read. Core resolves the transient URL, applies the repo-config trust gate, owns `pg` and the
pool, normalizes cells, caps rows and timeouts, and runs reads in a read-only transaction. Your plugin
never sees the URL or opens a socket. `data:write` implies that read surface and additionally permits
`query(..., { readOnly: false })`; it draws as a separate high-risk trust line. Parameters belong in
`options.parameters`, never interpolated into SQL. Identifiers cannot be parameters, so validate them
against `catalog()` before quoting them.

`permissions.api` is the **frame's** scope list, and unlike the node block it is genuinely enforced —
by an allowlist of (path shape, method) pairs at
`packages/client-core/src/host/frames/scopes.ts`, which is the choke point for everything a
sandboxed frame can reach. Your own `/v1/p/<id>` namespace needs no scope and is always allowed.
Another plugin's namespace is always denied. Everything else needs one of six scopes:

```
core.projects:config   core.projects:read   core.projects:write
core.tasks:read        core.tasks:write     core.workspaces:read
```

That is the whole grantable vocabulary (`GRANTABLE_SCOPES`, derived from the table rather than copied
beside it). Much of core is listed in the table with no mapping at all and can never be granted
whatever a manifest declares — the plugin install route above all, because a frame that could reach it
would install unsandboxed code and make every other line moot.

`permissions.events` names channels the frame may subscribe to. Subscribing does not create a channel,
and there are two kinds to name:

- **Five of the shell's own**, listed in `client-core/host/frames/channels.ts`. Four say that
  something a frame may be showing has gone or moved: `runtime:task-archived`,
  `runtime:workspace-removed`, `runtime:node-removed`, `runtime:node-switched`. The fifth,
  `runtime:focus-changed`, says which pane and region of this window the keyboard is in, as
  `{ taskId, paneId, regionId }`. All five are about one window, so a node never broadcasts one and a
  second window never sees yours.
- **Another plugin's live channel**, `plugin:<other-id>:<verb>`, when that plugin lists the verb in
  its manifest's top-level `emits` array. If it is not installed you hear nothing and get no error, so
  treat the frame as "go re-read" and never as the only way you learn something.
- **Your own live channel**, `plugin:<your-id>:<verb>`, which your node half broadcasts on with
  `ctx.events.send({ channel, ...payload })` and which core routes to whichever of your frames
  subscribed. Both halves are lowercase, start with a letter, and hold no colon. Another plugin's
  undeclared verbs are refused, exactly as its routes are.

That last one is how a frame gets live data without polling, and it also nudges your own descriptors
— badges, rail rows — so they update faster than the 30-second floor a declared `refresh` allows. See
[plugins.md § The live channel](../plugins.md) for the cadence rules and what a push does *not* reach.
