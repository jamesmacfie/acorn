# Authoring a plugin by hand

This is the contract under which a loaded plugin needs **no build step at all**: a directory of plain
files an author — or an agent — writes directly, installs, and iterates on. It is a subset of what
[plugins.md](./plugins.md) describes, not a different tier. Everything here loads through the same
loader, the same manifest schema, the same trust prompt and the same route confinement as a package
`apps/node/scripts/build-plugin.mjs` produced.

It exists because the node ships no bundler and will not grow one. Shipping a bundler means size, a
supply chain, and a compile step inside the trusted process — three costs paid forever so that a
plugin can use syntax it does not need. The cheaper answer is to write down what the loader already
accepts and stay inside it. Two constraints carry the whole profile:

- **The node half may import only relative paths and `node:` builtins.** Multi-file works; bare npm
  specifiers do not, because an installed package has no `node_modules` beside it.
- **The client half is exactly one file of plain JavaScript.** A plugin origin serves one script, so
  there is nothing for a second module to be fetched from.

Neither is a new rule. Both are properties the loader and the frame scheme have had since they
shipped; what is new is that they are a contract, so a change in the loader's tolerance is a
deliberate edit here rather than a silent widening.

## The package

```text
<dataRoot>/plugins/<id>/
  acorn-plugin.json      the manifest — the only file the loader trusts about this directory
  node/
    index.js             default-exports the NodePlugin
    routes.js            imported by index.js with a relative specifier
  client.js              one file, plain JS, no imports
  migrations/            a Drizzle chain, only if this plugin owns tables
    meta/_journal.json
    0000_<tag>.sql
```

The layout above is a convention; only the manifest filename is fixed. `MANIFEST_FILE` is
`acorn-plugin.json` (`packages/node-core/src/main/pluginManifest.ts`), and every other path in the
package is wherever the manifest says it is.

The directory is the unit of identity. A manifest may name any directory, but the **id** in the
manifest is what binds the route namespace, the renderer route prefix and the SQLite filename, and it
can never change — see "Plugin ids are permanent" under Updating below.

## The manifest

`packages/protocol/src/pluginContract.ts` is the schema, declared once because the node parses it off
disk and the client registers contributions from the same shape. Its top-level keys:

| Key | Required | What it is |
| --- | --- | --- |
| `id` | yes | Matches `/^[a-z][a-z0-9-]{1,31}$/` — 2 to 32 characters, lowercase, no dots. The dot ban is what keeps `<dataRoot>/plugins/<id>/` and `<dataRoot>/plugins/<id>.sqlite` in one directory without colliding. |
| `name` | yes | Display name, 1–120 characters. |
| `version` | yes | Free-form string, 1–64 characters. Compared on update by the installer's downgrade guard. |
| `apiVersion` | yes | Must equal this node's `PLUGIN_API_MAJOR` by **exact string match** — `'2'` today (`packages/protocol/src/pluginApiVersion.ts`). Anything else is a `failed` roster row with the mismatch as its reason. |
| `icon` / `icons` | no | One SVG path `d` string, or a map of them, authored in a 24×24 box. Not an SVG document — a document would mean `<script>`, `<use href>`, `on*` handlers and an allowlist parser, for a logo. Registered as `brand:<id>` and `brand:<id>/<key>` and nameable as any contribution's `glyph`. |
| `node` | no | Relative path to the ESM entrypoint the node imports. Omit it for a client-only or descriptor-only plugin. |
| `client` | no | Relative path to the single client file. Omit it for a plugin that ships only descriptors and document surfaces — it then has no bytes to trust and no trust prompt. |
| `migrations` | no | Relative path to the Drizzle chain. |
| `permissions` | defaulted | See below. Omitting it means an empty declaration, not a full one. |
| `contributions` | defaulted | See below. |

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
| `apiVersion` | imported from `PLUGIN_API_MAJOR` | write the current major as a string |
| `node` | `'./dist/node.js'` | your own relative path, e.g. `'./node/index.js'` |
| `client` | `'./dist/client.js'` when a client is declared | your own, e.g. `'./client.js'` |
| `migrations` | always `'./migrations'` in the built package | wherever your chain actually is |

Everything else in the generated manifest — `name`, `icon`, `icons`, `permissions`,
`contributions` — is copied through from the config untouched, so a `acorn-plugin.config.mjs` in the
repository is a faithful reference for what those blocks look like. `plugins/http/acorn-plugin.config.mjs`
is the widest one that owns tables; `plugins/model-providers/` is the narrowest (`contributions: {}`).

### Contributions

`contributions` is a loose object — a manifest written for a newer acorn contributes less on an older
one rather than failing to parse — with fourteen named keys, each capped. The caps are not arbitrary:
each one is the point past which a contribution stops being an integration and starts being an app
inside someone else's chrome.

The rule that decides which key you want: **descriptors for chrome, frames for rectangles.** A frame is
for a rectangle with real UI inside it. Everything smaller — a chip, a badge, a menu row, a palette
entry — is a descriptor you declare and the host draws. A descriptor costs no document, looks native
because it *is* the host's own components, and stays live when no frame of yours is mounted anywhere,
because its data comes from a route on your always-running node half.

| Key | Cap | What it declares |
| --- | --- | --- |
| `frames` | 32 | A rectangle your client file draws: `pane` (task- or project-scoped), `refPanel`, `settings`, `importer`, `webview`, `overlay`, `coreSlot`. Also where a pane declares a host-owned `layout` (document surface) and its `claimsKeys`, and where a `coreSlot` surface names which core surface it offers to replace. |
| `sources` | 8 | A rail source. Rows come from a route on your node half; the host draws them and executes the `onSelect` verb. |
| `slots` | 8 | A badge in an enumerated host slot: `footer` (the **task** footer, so it is invisible until a task is open) or `topbar` (the topbar's right end — the app's status bar). Nothing else is open, and `docs/plugins.md § Descriptors for chrome` records why each refused slot is refused. |
| `palette` | 32 | The pre-`commands` spelling of a palette row, still parsed as an alias for a command with `palette: true`. Prefer `commands`: this key takes the *full* verb union rather than the narrow one, which is a legacy inconsistency and not a capability worth reaching for. |
| `commands` | 32 | A command, id-qualified by the host to `plugin.<id>.<command>`. Takes the narrow verb set only. |
| `keybindings` | 32 | A chord for a command from the same manifest. Canonical `meta+ctrl+alt+shift+key` order, must include `meta`, `ctrl` or `alt`, `when` is `global`/`task`/`surface`, and one binding per command. |
| `attention` | 4 | An attention-inbox feed, fetched per node from your route. |
| `nodeStats` | 4 | A node statistic, with a singular/plural label pair so a card reads "1 card stuck". |
| `contentLinks` | 16 | A bounded `https://` URL recogniser that delivers one captured segment to a task pane, your reference panel, or both. It must have at least one destination or the manifest is rejected. |
| `routes` | 8 | A renderer URL for a project-scoped pane, confined to `/p/:projectId/x/<id>/`. Eight, matching `sources`, because a route addresses something inside a surface a rail already reached. |
| `agentContexts` | 4 | An entry in the agent composer's context picker: an `options` GET and a `capture` POST. |
| `refResolvers` | 4 | A batch enrichment route so another plugin's surface can turn identifiers of your items into a label and a state chip. |
| `themes` | 8 | A **colour** theme: `{ id, label, dark?, tokens }`, where `tokens` is the complete palette. You write no CSS — the host generates the block. See below. |
| `contextMenus` | 8 | A row on a host-drawn right-click menu: `{ id, location, label, icon?, order?, when?, action }`. `location` is from a closed list (`task.row` today); `when` is a map of literals that must all equal the target's facts; `action` takes the narrow verb set and receives the id of what was right-clicked. |
| `extensionPoints` | 4 | A strip inside one of **your** panes that other plugins may fill: `{ id, label, location, surface }`. `location` is from a closed list (`pane.footer` today) and `surface` must be a `pane` this manifest declares. You write no code for it — the host draws the strip. |
| `extensions` | 8 | Rows **you** put inside another plugin's point: `{ id, point, label, order?, items, onSelect?, refresh? }`. `point` is `<ownerPluginId>:<pointId>`, `items` is a GET on your own namespace, `onSelect` takes the narrow verb set. |

A theme is the one contribution with no route and no bundle behind it, so it is the cheapest thing a
plugin can be. `tokens` must carry **exactly** the palette token names and nothing else: a missing one,
an unknown one, a derived one (`--danger`, `--surface-sunken` — those are `var()` references the host
declares once) or a style-axis one (`--radius`) all fail the parse. Values are a hex colour or a flat
colour function — `#1e1e2e`, `rgba(0, 0, 0, 0.42)`, `oklch(0.7 0.15 250)`; named colours, `var()` and
nested functions are refused. `dark: true` is how a theme says it is dark, and the host writes
`--is-dark`, `--color-scheme` and `--syntax-fg` from it — never try to set those three. The result is
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

A `coreSlot` frame is the related pattern for acorn's *own* surfaces:
`{ target: "coreSlot", id, label, coreSlot }` plus a client bundle, where `coreSlot` names one of the
designated surfaces (`rail.taskList` today). Declaring one **seizes nothing** — the user picks the
provider in Settings → Plugins, and acorn draws its own again the moment your plugin is disabled or your
surface throws. It is not a pane, so no verb can name it and it never appears in the pane switcher.

Every path in every descriptor is confined at parse time to `/v2/p/<id>/` — your own namespace and
nothing else. That check lives in `pluginManifest.ts` rather than on the fields because it needs `id`,
and it is the parse-time twin of the runtime confinement the frame bridge applies.

The cross-field rules are worth knowing before you write a manifest that parses and then does nothing:
an `openPane` must name a task-scoped pane this manifest declares; a `navigate` must name a
project-scoped one; a project-scoped pane needs both a `routes` entry (its only address) and a source
whose `onSelect` navigates to it (its only mount site); an `overlay` needs an action that opens it; a
`surfaceAction` may name only a `document-over-frame` pane; a webview needs a client bundle; an
extension point must hang off a `pane` this manifest declares and only one may sit at each location on
it; an `extensions` entry's `point` must be a `<pluginId>:<pointId>` reference and its `items` route
must be your own; a `coreSlot` surface needs both a designated slot name and a client bundle; and no id
may repeat across contributions.

### The action verbs

Descriptors do not run plugin code. They hand the host a verb from a closed set, and the host executes
it. Closed is the point: every plugin composes the same few verbs, and adding one later is additive
where removing one would not be.

The full set. It is meant for a rail source's `onSelect` — the one click site that has a selected row,
a routed project and the host's promotion callback in scope. (The legacy `palette` descriptor also
accepts it, which predates the split and should not be relied on.)

| Verb | Effect |
| --- | --- |
| `openPane` | Push a task-scoped pane from this manifest into the active task's layout, carrying the clicked row's id as a pane intent. |
| `navigate` | Change the URL to the route this manifest declared for a project-scoped pane, with the selected row as the addressed item. |
| `runNodeAction` | POST to a path inside `/v2/p/<id>/`. |
| `createTask` | Host-owned promotion: the row supplies the task seed, the host owns the modal, the ownership check and the ordering. |
| `openUrl` | `https` only, in the real browser. |
| `openOverlay` | Open a full-screen picker this manifest declares. |
| `surfaceAction` | Deliver this command's own id to the frame region of a `document-over-frame` pane. The only verb whose effect lands inside a plugin. |

Commands, slot badges and a source's `emptyState` take a **five-verb subset**: `openPane`,
`runNodeAction`, `openUrl`, `openOverlay`, `surfaceAction`. `createTask` and `navigate` are absent
because they need a selected row and a routed project respectively, and a command registry row has
neither. A verb that parses and can then only fail is worse for an author than one the manifest
refuses.

### Permissions

Three lists, and they are enforced in three different places.

`permissions.node` shapes the `ctx` your node half receives (`pluginPermissions.ts`). It is **least
privilege for cooperative code, not a sandbox** — a loaded bundle shares the node's process and can
`import('node:fs')` and ignore `ctx` entirely. Gating is by omission: an undeclared facet is absent,
so the first call is a `TypeError` the author sees immediately.

- `core`: `fs`, `git`, `tasks`, `context`, `models`, `identity`, `prefs`, plus `projects:read`,
  `projects:config`, `projects:write`. The project grants nest — `config` and `write` each imply
  `read` — and they are split because `checkouts()` returns where every codebase on the machine
  lives, and `config()` returns shell commands the node executes. An unknown token is skipped, not
  rejected: a manifest naming a facet from a newer build should lose that one grant.
- `capabilities`: capability ids this plugin may `get`/`require`. `provide` is never filtered —
  exporting a capability is a contribution, not an access grant.
- `secrets` / `exec`: booleans, separate from `core` because they are the two asks a reviewer should
  have to see spelled out.
- `net`: intended egress hosts. Pure disclosure today.

`permissions.api` is the **frame's** scope list, and unlike the node block it is genuinely enforced —
by an allowlist of (path shape, method) pairs at
`packages/client-core/src/plugins/frames/scopes.ts`, which is the choke point for everything a
sandboxed frame can reach. Your own `/v2/p/<id>` namespace needs no scope and is always allowed.
Another plugin's namespace is always denied. Everything else needs one of six scopes:

```
core.projects:config   core.projects:read   core.projects:write
core.tasks:read        core.tasks:write     core.workspaces:read
```

That is the whole grantable vocabulary (`GRANTABLE_SCOPES`, derived from the table rather than copied
beside it). Much of core is listed in the table with no mapping at all and can never be granted
whatever a manifest declares — the plugin install route above all, because a frame that could reach it
would install unsandboxed code and make every other line moot.

`permissions.events` names shell channels the frame may subscribe to. Subscribing does not create a
channel.

## The node half

The loader resolves `manifest.node` inside the package directory and does
`await import(pathToFileURL(entrypoint).href)` (`pluginLoader.ts`). That is the entire mechanism, and
it is why multi-file plain ESM needs no build: Node resolves your relative specifiers itself.

**Relative paths and `node:` builtins only.** A bare specifier — `hono`, `zod`, `drizzle-orm` — has
nothing to resolve against, because an installed package is a bare directory with no `node_modules`.
A compiled package gets away with them only because the builder inlines every one of them into the
bundle.

There is a trap here worth stating plainly: Node's resolution walks *ancestor* directories looking for
`node_modules`, and a development data root sits inside the repository, where ancestors have one. So a
bare specifier can resolve on the machine that wrote it and fail on every machine that installs it,
where the data root is under the user's application-support directory with no `node_modules` anywhere
above it. "It worked in dev" is not evidence here.

The default export must satisfy `asNodePlugin` — a **structural** check, not `instanceof`, because a
separately-compiled bundle's classes are its own:

```js
export default {
  name: '<must equal the manifest id>',   // string, required
  init(ctx) {},                            // function, required, may be async
  ready(ctx) {},                           // optional; runs after every plugin's init
  dispose() {},                            // optional
}
```

`plugin.name` is checked against `manifest.id` and the load fails on a mismatch. The host binds every
namespace from the manifest, so a bundle cannot mount itself under another plugin's prefix by lying;
a mismatch means the package is internally inconsistent, and picking a winner silently is how
squatting starts.

What a loaded plugin's `ctx` does **not** have, whatever the manifest says: `ctx.routes.register`
(Hono), `ctx.events.channel` and `ctx.events.streams`. A Hono instance cannot cross a process
boundary; a `(Request, PluginRequestContext) => Response` function can, so `ctx.routes.fetch(handler)`
is the door. The host strips the mount before calling you, so a request to
`/v2/p/<id>/greeting` reaches your handler as `/greeting` — the same relative path a mounted router
would see. `ctx.storage`, `ctx.core`, `ctx.tools`, `ctx.contextSections`, `ctx.providers`,
`ctx.capabilities`, `ctx.events.send`/`status`/`notice` and `ctx.log` are all present, shaped by the
manifest.

## The client half

A frame is a **host-generated iframe document**, not a component in the shell's tree. Electron main
serves it from a content-addressed cache on `app-plugin://<bundle-hash>/`, and the handler answers
exactly four paths (`apps/desktop/src/app/main/pluginScheme.ts`):

- `/` and `/index.html` — the generated document. The plugin owns what runs; it does not own the
  document, the CSP or the bootstrap, which is what keeps the policy un-overridable by markup.
- `/ui.css` — the host's shared presentation stylesheet, identical at every plugin origin.
- `/client.js` — your file.

Everything else is a 404. **That is the single-file rule**: there is no plugin-controlled asset tree,
so a second module, a stylesheet, an image or a font cannot be fetched. Inline them — the CSP allows
`img-src 'self' data:` for exactly this. And `connect-src 'none'` means a frame has no network at all:
not a restricted one, none. `fetch`, XHR, WebSocket, `sendBeacon` and EventSource all fail. Its only
I/O is the `MessagePort` the host transfers in.

Because the document is the host's and it loads your file as a module script, there is also no
framework requirement. Vanilla DOM is the natural fit, and the bridge is the whole surface a frame
has anyway.

Two browser affordances that are absent and surprise people: `window.confirm` and `alert` are
suppressed (the iframe is deliberately not `allow-modals`, so `confirm()` returns `false` and a
guarded action silently does nothing), and `navigator.clipboard` refuses to write because the frame's
document is not the focused one. Use the bridge's `ui.copy`, and draw your own confirmation.

### Reaching the bridge

In-repo frames import `connect()` and `mountFrame()` from `@acorn/plugin-api/ui/sdk`. **A hand-written
`client.js` cannot.** That is a bare specifier with no bundler to resolve it, and the origin would have
nowhere to serve the resolved file from even if there were. Copying the SDK's source in is not an
option either: `packages/client-core/src/plugins/frames/sdk.ts` is TypeScript and imports from
`@acorn/protocol`, so it has the same problem one level down.

So the supported answer is: **inline the handshake yourself.** It is about thirty lines, the protocol
is versioned, and there is a worked precedent in the tree —
`apps/desktop/e2e/pluginFrame.spec.ts`'s fixture bundle is hand-written ESM with the handshake inlined
precisely so the fixture does not depend on a bundler run. Read `sdk.ts` for the semantics; it stays
the reference implementation even when you are not importing it.

The sequence (`packages/protocol/src/pluginBridge.ts`):

1. The host posts `{ acornBridge: 1 }` into your window with a `MessagePort` transferred alongside.
   `1` is `PLUGIN_BRIDGE_VERSION`; a future protocol change is a different number rather than a
   silently mis-parsed message. There is no origin check to get wrong — a message with no port is not
   the handshake, and the port is unforgeable.
2. You take `event.ports[0]`, set `onmessage`, and call `port.start()`.
3. The host sends `{ kind: 'ready', context }`. `context` is a **snapshot**, not reactive: `surface`,
   `target`, `nodeId`, and — depending on the surface — `taskId`, `projectId`, `refId`, `item`,
   `theme`, `style`, `claimsKeys`.
4. **You must post something back.** The host arms a 10-second deadline when it transfers the port and
   replaces the frame with a labelled "This plugin's UI failed to start" placeholder if nothing
   arrives, because a bundle that throws at module scope otherwise renders a blank rectangle and
   reports nothing. `{ kind: 'connected' }` is the canonical ack; any message counts.

Requests are `{ id, kind, ... }` with an id you increment; replies are `{ id, ok: true, status, body }`
or `{ id, ok: false, error: { code, message, requestId, retryable } }`. The failure arm is the same
envelope every HTTP route returns, so you handle one error shape whether the call was denied at the
bridge or refused by the node.

Two host→frame pushes have no request behind them. `{ kind: 'appearance', theme, style, tokens }`
arrives on connect and on every appearance change; **apply it or your frame renders unthemed** — set
`data-theme` and `data-style` on `documentElement` and write each token as a CSS custom property on
it, which is what makes the host's `/ui.css` classes and your own `var(--bg)` rules resolve. The SDK
does this for you and a hand-written frame must not forget it. `{ kind: 'select', item }` is every rail
selection after the one that opened the pane, and `{ kind: 'surfaceAction', command }` is a command
the host resolved on your behalf.

Two budgets apply to the port, and tripping either kills it and swaps in a "plugin misbehaving"
placeholder: 100 requests in flight, and 1000 messages per 10 seconds.

### What the bridge carries

The verb set, as the SDK's `AcornBridge` type names it — a hand-written client is sending the same
messages by hand:

| Surface | Verbs |
| --- | --- |
| `context` | The `ready` snapshot. |
| `api` | `get`, `post`, `put`, `patch`, `del` — five, matching `PluginBridgeApiRequest.method` exactly. A method missing from the facade is a method no plugin can reach, however permissive the scope table underneath. |
| `events.on` | Subscribe to a channel the manifest declared. |
| `state.get` / `state.set` | Durable storage keyed `(pluginId, key)` by the host, capped at 1 MiB per value. The same `plugin:<id>:*` namespace your node half's `prefs` facet is projected into — this is the supported node-half↔frame state channel. Distinct from the frame's own `localStorage`, which works but is keyed by bundle hash and so rotates with every update. |
| `ui.toast` / `ui.copy` / `ui.openPane` / `ui.openUrl` / `ui.done` / `ui.close` | The closed effect set. `openUrl` is `https` only, honoured only while the frame holds focus and at most once per second, and you learn nothing back. `done` is importer-only; `close` is importers and overlays. |
| `document.read` / `write` / `flush` | Only from a `document-over-frame` pane. Nothing about the *editor* crosses — no cursor, no selection, no decorations. |
| `webview.*` | `navigate`, `back`, `forward`, `reload`, plus navigation and blocked events. Controller-only: you cannot read the page or type into it. |
| `keys.claim` | Narrow the manifest's declared chord set at runtime. It can never widen it. |

## Storage and migrations

A table-owning plugin ships a Drizzle chain **inside its package** and names it in the manifest. The
host — never the plugin — opens the database and applies the chain at `ctx.storage.open()`
(`pluginStorage.ts`, `openPluginDb`), so a plugin never picks a database path or discovers a chain by
filesystem proximity. The file is `<dataRoot>/plugins/<id>.sqlite`, and the handle you get back is a
drizzle handle with `batch` and `close`.

The chain must be a real chain: `pluginMigrationsChain` requires `meta/_journal.json` in the declared
directory, because a directory without a journal silently applies nothing, and a plugin that opens
storage while declaring no `migrations` gets a thrown `PluginMigrationsError` rather than an empty
database. A journal is small enough to write by hand:

```json
{
  "version": "7",
  "dialect": "sqlite",
  "entries": [
    { "idx": 0, "version": "6", "when": 1786177106101, "tag": "0000_init", "breakpoints": true }
  ]
}
```

with `0000_init.sql` beside it holding the DDL. A broken chain fails **contained** — that plugin ends
up `failed`, the node boots, other plugins are untouched.

## Installing a hand-written package

The install route is unchanged and deliberately unreachable from plugin code:
`POST /v2/core/plugins/install`, owner or device principal, `Idempotency-Key` header required,
audited. For a hand-written directory the source form is a local path:

```json
{ "source": { "path": "/absolute/path/to/my-plugin" } }
```

`linkLocal` (`pluginInstaller.ts`) **symlinks** the directory rather than copying it, which is what
makes the loop worth having: you edit in place and the next boot runs what you edited. It is gated on
`allowLocalPath`, which is on for development builds only (`!config.isPackaged` under the desktop,
`NODE_ENV !== 'production'` standalone) — a packaged app refuses a local path outright. The path must
be absolute. Uninstall unlinks rather than following the symlink into your working tree.

Installing writes a lockfile and reports `installed-restart-required`. A loaded plugin's routes,
tables and jobs wire at init, so a package is not live until the node re-runs it: restart the node,
and under the desktop use Settings → Plugins → Restart, which also reloads the renderer because frame
contributions resolve once per session.

If the package has a client file, each device asks its own owner before running those bytes, keyed by
`(pluginId, hash)`. Rewriting `client.js` changes the hash and re-prompts. A package with no `client`
key has nothing to trust and registers its descriptors directly.

**If an agent is writing the package**, it should call the `plugin_authoring` agent tool first: it answers
with this contract plus the connected node's *current* manifest vocabulary, action verbs and bridge
messages read off that node's own schemas, which is the only way to be sure an answer is not from memory
([agent-tools.md](./agent-tools.md)). It cannot call the install route — no task-scoped token reaches it. It
asks instead, with the `plugin_request` agent tool, and the owner approves in the shell; the device then
installs. Asking with `dev: true` also puts the plugin into development mode on the approving device, which
auto-trusts its later bundles and turns the loop into edit → reload rather than edit → prompt → restart.
[plugins.md § Approval-mediated install](./plugins.md) and
[security.md § The dev grant](./security.md) are the full story, including how the owner ends it.

When something does not load, the roster row says why: the manifest reason names the offending field
paths (up to three, then "and N more"), and `stage` distinguishes `'load'` — a package that never ran
— from `'init'` and `'ready'`.

## A complete example

A plugin with a node half in two files and one vanilla pane. Every symbol in it is checked against the
contracts above.

### `acorn-plugin.json`

```json
{
  "id": "hello-acorn",
  "name": "Hello Acorn",
  "version": "0.1.0",
  "apiVersion": "2",
  "node": "./node/index.js",
  "client": "./client.js",
  "permissions": {
    "api": [],
    "events": [],
    "node": { "core": ["tasks"], "capabilities": [], "secrets": false, "exec": false, "net": [] }
  },
  "contributions": {
    "frames": [
      { "target": "pane", "id": "hello-acorn", "label": "Hello", "glyph": "hand", "order": 800 }
    ]
  }
}
```

`api: []` is correct and not an omission: the frame calls only this plugin's own namespace, which
needs no scope. `core: ["tasks"]` is there because the route below resolves a task.

### `node/index.js`

```js
import { handle } from './routes.js'

// Relative imports and `node:` builtins only — this directory has no node_modules.
export default {
  name: 'hello-acorn',
  init(ctx) {
    // The portable carrier. The mount is stripped, so `/v2/p/hello-acorn/greeting`
    // arrives here as `/greeting`.
    ctx.routes.fetch((request, context) => handle(request, context, ctx.core))
  },
}
```

### `node/routes.js`

```js
export async function handle(request, context, core) {
  const { pathname, searchParams } = new URL(request.url)

  if (request.method === 'GET' && pathname === '/greeting') {
    const taskId = searchParams.get('taskId')
    // core.tasks answers with a TaskRef projection — id, title, projectId, branch,
    // worktreePath, pullNumber — never the row.
    const task = taskId ? await core.tasks.load(taskId) : null
    return Response.json({
      text: task ? `Hello from ${task.title}` : 'Hello from the node',
      who: context.userId,
    })
  }

  return new Response('not found', { status: 404 })
}
```

### `client.js`

```js
// The bridge handshake, inlined. @acorn/plugin-api/ui/sdk is what a bundled frame imports;
// a single-file frame has no way to resolve a bare specifier, so it sends the same messages
// by hand. packages/client-core/src/plugins/frames/sdk.ts is the reference for the semantics.

const pending = new Map()
let port = null
let seq = 0

const connected = new Promise((resolve) => {
  addEventListener('message', (event) => {
    if (!event.data || event.data.acornBridge !== 1) return   // PLUGIN_BRIDGE_VERSION
    port = event.ports[0]
    port.onmessage = (e) => {
      const message = e.data
      if (!message) return
      if (typeof message.id === 'number') {
        const waiting = pending.get(message.id)
        pending.delete(message.id)
        waiting?.(message)
        return
      }
      if (message.kind === 'ready') {
        // The ack. Without it the host's 10s deadline swaps this frame for a placeholder.
        port.postMessage({ kind: 'connected' })
        resolve(message.context)
      }
      if (message.kind === 'appearance') applyAppearance(message)
    }
    port.start?.()
  })
})

function applyAppearance({ theme, style, tokens }) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.style = style
  // Without this the host's /ui.css classes and every var(--…) in your own CSS fall back.
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
}

const send = (message) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, (reply) => {
    if (reply.ok) resolve(reply.body)
    else reject(new Error(`${reply.error.code}: ${reply.error.message}`))
  })
  port.postMessage({ ...message, id })
})

const get = (path) => send({ kind: 'api', method: 'GET', path })
const toast = (title) => send({ kind: 'ui', op: 'toast', title })

// The document already exists and already links /ui.css — a module script runs after it parses.
const root = document.createElement('div')
root.style.padding = '16px'
document.body.append(root)

connected.then(async (context) => {
  const query = context.taskId ? `?taskId=${encodeURIComponent(context.taskId)}` : ''
  const { text } = await get(`/v2/p/hello-acorn/greeting${query}`)

  const heading = document.createElement('h1')
  heading.textContent = text

  const button = document.createElement('button')
  button.className = 'ui-btn'             // from the host's /ui.css
  button.textContent = 'Say hello back'
  button.addEventListener('click', () => void toast('Hello from the frame'))

  root.append(heading, button)
}).catch((error) => {
  root.className = 'ui-alert'
  root.dataset.variant = 'banner'
  root.dataset.tone = 'danger'
  root.textContent = String(error)
})
```

Install it with the local-path source above, restart the node, accept the bundle when the device asks,
and the pane is in the task pane switcher.

## Updating a plugin, and the data underneath it

Most of this machinery already ships. The stance below is the contract an author — human or agent —
is held to, and some of it describes machinery that does not exist yet. Those lines are marked.

1. **Agents may update plugins they authored.** A dev-mode install is the agent's own package, and
   iterating on it is the loop this profile exists to serve. Updating a **store-distributed** plugin
   stays a human decision, through the same approval flow as install — which is every update, because the
   agent's `plugin_request` is a question and the device is what installs the answer.
2. **Schema changes are append-only. Never edit or reorder a shipped migration.** Add a new entry to
   the chain instead. This is a rule you follow, backed by a mechanism that catches you: Drizzle
   validates the chain against `meta/_journal.json`, so a reordered chain already fails.
3. **There is no downgrade support, and there will not be.** Once a migration has widened the schema,
   running the previous version of the plugin against it is undefined behaviour at the data layer —
   reads may work by luck, writes may violate what the new columns assume. The documented fallback for
   a bad update is **reinstall with purge**, or restoring the `.sqlite` from whatever backup discipline
   the node has. Both halves of this ship today: `guardDowngrade` refuses an install that resolves to
   an older version unless the caller explicitly asks for a downgrade, and `uninstallPlugin` takes a
   `purgeData` option that removes the `.sqlite` and its WAL/SHM siblings. By default uninstall
   **keeps** the data, so remove-and-reinstall is not data loss.
4. **Reload applies migrations mid-process in dev mode only, and schema changes are exempt from
   candidate rollback.** Registration rollback and schema rollback are different promises, and only the
   first is made: if a reloaded plugin's `init` fails, the previous registrations stay live, but a
   migration that already ran has still moved the schema and cannot be un-migrated. Reload also
   re-evaluates **only the entry module**, so a multi-file node half needs a node restart for a change
   that lands outside its entry file ([plugins.md § The dev loop](./plugins.md) has all four limits).
5. **Plugin ids are permanent.** The id *is* the SQLite filename, as well as the route namespace, the
   renderer route prefix and the persisted layout key for every pane. A table-owning plugin's id can
   never change across any update, ever. "Rename a plugin" is not a feature that can be added later —
   it is "new plugin, plus a data migration, plus a tombstone", and it should be costed as such.

## What this profile refuses, and why

- **No bundler in the node.** Size, supply chain and a compile step inside the trusted process, paid
  permanently. If the profile proves too tight — a plugin genuinely needs a dependency or JSX — the
  escape hatches in order of preference are: shell out to a dev checkout's `build:plugin`, which
  already exists and already has Vite; and only then consider shipping a bundler. Real friction should
  justify the dependency, not the anticipation of it.
- **No multi-file plugin origins.** Serving an asset tree at `app-plugin://<hash>/` would mean the
  hash claim covers a directory rather than a file, which is strictly harder to audit for exactly
  nothing an inlined `data:` URI cannot do.
- **No host-drawn widgets from data.** The bar for a host-owned region is that the sandbox *cannot*
  serve it. Monaco clears that bar — it does not fit under the bundle cap and its workers cannot be
  delivered at a one-file origin. Master/detail does not: every frame already draws one with ordinary
  CSS, and the host rendering a plugin's list from data means designing and eternally versioning a
  widget toolkit in the wire format. **Common is not the bar; impossible is.**
- **The profile is a contract, not a code path.** It is versioned with the plugin API major and
  nothing enforces it beyond what the loader and the scheme already do. When the loader's tolerance
  changes, this file is the thing to update deliberately — an implicit property of what the loader
  happens to accept is not a contract anyone can write against.
