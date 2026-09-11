# Activation

[Back to plugins](../plugins.md)

## Activation

`apps/node/src/composition/plugins.ts` is the Node activation list. `apps/desktop/src/client/plugins.ts`
is the client activation list. The host validates unique names, applies the per-Node disabled-plugin
set, initializes enabled plugins, runs the optional ready/activation pass, and owns disposal of their
registrations.

Required plugins are agents, memory, notes, and terminal. GitHub is optional: when enabled it contributes
the provider, PR rail, importer, and mirror routes; when disabled core Home and the remaining plugins
still boot.

Optional plugins can be disabled per Node through Settings → Plugins; their SQLite files remain on
disk and can be re-enabled later.

Settings → Plugins, install included, is scoped to one Node at a time, with a node picker at the top.
Which plugins a Node runs decides which routes exist and which SQLite files it opens, so disabling a
plugin is a statement about one machine: a fleet is a set of independently administered nodes, and
there is no "install everywhere" or "disable everywhere" here.

The page shows two facts per row, not one: `disabled` is what will happen (it takes effect at the
Node's next start, since routes, tables, and jobs are wired at init) and `running` is what is happening
now. Between saving a toggle and restarting the Node, the two can differ, and the page keeps both
visible with a restart banner rather than collapsing them into one state that would either lie about
the checkbox or hide the pending restart. Install and update carry the same banner, for the same
reason: a package that installed onto the Node's disk has not necessarily started running yet.

Node initialization happens before the listener accepts requests. Every plugin's `init` runs at once,
and so does every plugin's `ready`, so **declaration order is not a contract**. A plugin whose `init`
reads what another plugin's `init` registered is a bug, and it was a bug before the passes overlapped:
disabling one plugin removes a step from the sequence, and the composition list is grouped by domain
rather than by dependency. Cross-plugin needs have two answers. Resolve a capability at call time,
inside the closure that needs it, which is what `ctx.capabilities.get` is for. Or read the other
plugin's contributions in `ready`, which is the pass that exists for exactly this and runs only after
every `init` has finished.

`initPlugins` proves the property with a test rather than a promise: it initialises one roster in
declaration order, reversed, and shuffled, and asserts the same registrations each time
(`packages/node-core/src/server/pluginHost/host.test.ts` § order independence).

Failure is per plugin. A built-in that throws in either pass fails the boot and every plugin that did
initialise is disposed first, because each holds a write-ahead-log SQLite handle and the composition
root releases the data-root lock on the way out. A plugin loaded from disk is contained instead: its
registrations roll back, its row reads `failed`, and its neighbours reach `ready`. The one thing that
changed when the passes started overlapping is which plugins have run by the time a failure is read.
All of them have, so all of them are torn down rather than the ones declared before the failure.

A plugin can register:

- routes under `/v2/p/<plugin>/...`;
- typed capabilities;
- client broadcasts through `ctx.events`;
- agent tools and task-context sections;
- integration, connection, and model-provider descriptors;
- a plugin-owned SQLite migration chain and disposal hook.

Two things a plugin CANNOT register, because they are the host's to write on its behalf: node actions
and managed-agent harnesses. Both come from the manifest — a command whose verb is `runNodeAction`, and
`contributions.harnesses` — and the host replays them through `HostPluginContext`, a shape
`server/pluginHost/types.ts` keeps deliberately off the authoring type. They sat on `NodePluginContext`
until 2026-08-27, reading as members an author should reach for, and across 21 plugins nobody ever did.

`ctx.log` came back on 2026-09-10, and the reason it went is the reason it is back. It was removed
because it was interchangeable with `console` at every call site: two plugins used it, four reached
past it, and the seam bought no attribution. It is not interchangeable now. A line written through
`ctx.log` carries the plugin id the host bound, reaches every subscribed telemetry sink, and passes
the scrubber on the way, and none of that is true of a `console.error` with a hand-typed prefix
([telemetry.md](../telemetry.md) § Logging). `ctx.telemetry` arrived beside it, for spans, counts,
gauges and errors about the plugin's own work. Neither needs a permission: measuring your own work
reads nobody else's.

The host supplies `CoreServices` for confined filesystem access, Git, processes, secrets, tasks,
repositories, task context, model generation, preferences, and the machine identity. Plugins do not
receive the core database handle merely to query shared tables.

What `CoreServices` hands back for a core entity is a PROJECTION, never the row. `projects` answers with
`ProjectRef` — id, name, path, workspace, GitHub facet — and `tasks` answers with `TaskRef`: id, title,
projectId, branch, worktreePath, pullNumber, and nothing else. `tasks.load()` used to return
`typeof schema.tasks.$inferSelect`, which put core's own column names on the plugin contract: renaming a
column would have broken every plugin with no signal at all, because the surface snapshot pins names and
cannot see a type change shape underneath a stable one. The six fields on `TaskRef` are exactly what
plugin code reads; `icon`, `origin`, `status`, `parentId`, `sort`, `createdAt`, `updatedAt` and
`archivedAt` are read by nobody outside core and stay core's. `taskContext()` and the `WORKTREE_CREATED`
hook take a `TaskRef` too, so a plugin can hand back what it was given.

It supplies no HTTP client. This list named one, and none exists — see docs/http-client.md for why
that matters and when it will have to.


## Loaded plugins

A Node can also load a plugin's node half from disk, from `<dataRoot>/plugins/<id>/` — a directory
holding an `acorn-plugin.json` manifest and an ESM bundle that default-exports a `NodePlugin`. The
manifest's shape is declared once, in `packages/protocol/src/plugin/contract.ts`, because the client
registers contributions from the same shape and neither side may import the other;
`packages/node-core/src/server/plugins/manifest.ts` adds the cross-field rules that need `id` — route
confinement, surface reachability — and reads the file. Loaded plugins join the same
array and the same host passes as the compiled-in ones, so `ready`, capability late-binding and
disposal are identical, and order is no more load-bearing for them than for a built-in.

Three things differ, and all three follow from the code not being ours:

- **They get there through the installer.** `POST /v2/core/plugins/install` (owner/device principal,
  `Idempotency-Key` required, audited) resolves a GitHub release, an npm package, a tarball URL or a
  local folder; validates the manifest; and places the package atomically with a hash-pinned lockfile
  beside it — except for a folder, which is symlinked and therefore pins nothing
  ([security.md § Installing from a folder](../security.md)) (`packages/node-core/src/server/plugins/installer.ts`,
  docs/plugins.md). Uninstalling removes the package and, by default, leaves its
  SQLite file alone. Each device then asks its own owner before running the plugin's interface code.
  Nothing in that family starts a plugin — each answers "the disk now says this". The one exception is
  `POST /v2/core/plugins/:id/reload`, which swaps a loaded plugin's node half in the running process;
  see § The dev loop for its semantics and its four limits.
- **Failures are contained, and every failure names itself.** A built-in throwing from `init` still
  fails the boot — it is first-party code in the same binary, and a node that cannot assemble should say
  so. A loaded plugin throwing has its registrations rolled back, is reported through the roster
  (`state: 'failed'`) and the attention inbox, and the node keeps starting.

  A failed roster row carries `reason` and `stage` alongside `failedAt`. `stage` is `'init'` or
  `'ready'` for a plugin that ran and threw, and `'load'` for a package that never ran at all: a
  manifest that does not parse (the reason names the offending field paths, not just "does not match the
  schema"), an `apiVersion` this node does not speak, a `requires.plugins` entry naming a package this
  node does not have, an id a second directory already claims, a bundle that throws on import, a wrong
  default export. Those load failures used to end at a `console.error`
  in the node's stdout, which a packaged app shows to nobody — and a package whose bundle would not
  import read as `pending-restart`, with a Restart banner that restarting could never clear because
  restarting re-ran the same failing import. A load failure is now `state: 'failed'` with its reason,
  raises no banner, and a package the loader dropped before it could even be listed still gets a row.

  `reason` is a **loaded plugin's own text on its way to the owner's UI**: display-only, capped by the
  node, rendered as text and never as markup. Both fields are optional on the wire, so a client talking
  to an older node degrades to the generic sentence rather than to nothing. A load failure is a fact
  about the boot that observed it, so fixing the package on disk leaves the row reading `failed` with
  its original reason until the restart that re-reads it.
- **The context is shaped by the manifest.** `permissions.node` decides which `CoreServices` facets
  and capability ids the plugin can see. Which *members* it gets is not a manifest question at all: the
  answer is the `NodePluginContext` type in
  `packages/node-core/src/server/pluginHost/types.ts`, and everything missing from it is on
  `CompiledNodePluginContext` beside it (§ The two contexts, one per tier). A loaded plugin serves routes as
  `ctx.routes.fetch(handler)` instead — a `(Request, PluginRequestContext) → Response` function. A
  plugin that wants Hono anyway wraps its router in `portableCarrier(id)` from
  `@acorn/plugin-api/node`, which hands back the `portableFetch` wrapper and the matching
  `requestContext(c)` accessor; that pairing used to be fifteen pasted lines per plugin, and the four
  loaded plugins are its callers. The
  request context projects authenticated identity plus a provider runtime; it exposes provider-owned
  resource, connection and external-item operations without exposing Hono, the core database, or the
  secret service. The external-item calls exist for the read no per-connection resource can express —
  the same cached item across every connection of one provider, which is how a bare ticket id gets
  attributed to a workspace — and the host binds the owner and the provider ownership check. A
  loaded integration provider likewise passes a fetch handler to `ctx.providers.integration`; passing
  Hono is an explicit initialization error. Project access is deliberately three grants:
  `projects:read` for identity, checkout paths and workspace external-project mappings scoped to
  connection providers registered by that loaded plugin,
  `projects:config` for executable build/dev/database
  configuration, and `projects:write` for creating or updating project references. The `telemetry`
facet is the read side of the telemetry seam and the one grant that returns other packages' data:
a sink sees every record from every owner, so the trust prompt draws it high
([security.md](../security.md) § Telemetry sinks). Writing telemetry needs no grant at all. The
`prefs` facet
  is projected into `plugin:<id>:*`, the same namespace used by that plugin's frame `state.get` and
  `state.set` verbs; this is the supported Node-half↔frame state channel. Values are capped at 1 MiB
  from either side.

That last point is least privilege for **cooperative** code and honest disclosure for users, not a
security boundary: a loaded bundle shares the Node's process and can `import('node:fs')` and ignore
`ctx` entirely. `docs/security.md` is the full threat model, and every surface that
renders these permissions has to say *declared*, not *enforced*.

`apps/node/scripts/build-plugin.mjs` builds a repository plugin into this shape, reading the plugin's
declaration from the plugin's own package — `plugins/<id>/acorn-plugin.config.mjs`, where the directory
name is the plugin id — so a plugin's declared surface lives, and is reviewed, beside the code it
describes. Its default target is
the development data root; `--package-root` stages the same package for distribution. The desktop
build keeps its bundled roster in `apps/desktop/scripts/build-bundled-plugins.mjs`, packages the
result as read-only application resources, and asks the service to reconcile it before discovery.
Only packages recorded as app-owned are updated. An existing owner-installed version wins, and
uninstall writes a tombstone outside the package directory so a later app update does not restore it.
An unrecorded directory sitting in the plugin root is treated as owner-installed too, with one
exception: a package `build:plugin` wrote straight into the data root leaves a `.acorn-dev-build`
marker, and reconciliation treats a marked package as app-owned so a newer bundled version replaces
it. Without that, a developer's own build was indistinguishable from an installation, was recorded as
user-managed, and then quietly outlived every rebuild of the app — which presents as a feature that
does not exist. The marker is never written under `--package-root`, so nothing in a shipped resource
directory carries it, and a real install is protected exactly as before. Because an owner-installed row
is still checked first — deliberately, so a marker file cannot override ownership — `build:plugin` also
clears a `user` row for the id it is writing: that row is a claim about how the directory got there, the
script is authoritatively changing that, and without this a developer already trapped by a pre-marker
build would stay trapped through any number of rebuilds. Under `--package-root` the script cannot clear
that row — the staged output is not going into that data root, and could be for a different machine's —
so it prints the row, the file and the fix instead. Both Node hosts also report every ownership row at
boot (`reconcileBundledPackages` in `apps/node/src/composition/composition.ts`), because reconciliation's
"declined to update" list can only name a package it had a newer copy of, and the whole failure mode is a
frozen package on a node that has no newer copy to decline.
Bundled client bytes are trusted only after the desktop helper reads and hashes its own application
resource directory; a node cannot acquire that trust by labelling a roster row as bundled.

A bundled package has no lockfile, so the node has no source to re-resolve and its update route can
only refuse. The roster row says so structurally (`installed.bundled` on `InstalledPluginRow`), and
Settings → Plugins uses that to show neither update nor uninstall on a bundled row: update would only
ever error, and the checkbox already covers "stop running this" without the tombstone that uninstall
leaves behind.

## The dev loop

Seeing a change to a loaded plugin run used to be four steps and a page of host knowledge: rebuild by
hand, restart the node, reload the renderer, answer a trust dialog per bundled package. Three of the four
are the host's business, so the host does them.

This is the loop for a **repository** plugin, which is built. A package written by hand has no build
step to watch and is installed by absolute path as a symlink, so the rebuild half does not apply —
[plugin-authoring.md](../plugin-authoring.md) is that contract and that loop.

```sh
pnpm dev:plugin rollbar     # rebuild the package on every save
pnpm dev:node               # and this restarts itself when the bundle changes
```

`pnpm dev:plugin <id>` (`apps/node/scripts/dev-plugin.mjs`) watches the plugin's `src/`, its
`acorn-plugin.config.mjs` and its migration chain, and re-runs `build-plugin.mjs` — a fresh process per
rebuild, so there is no module cache to invalidate. It builds wherever `build-plugin.mjs` would: the dev
data root by default, or `-- --package-root ../desktop/dist/bundled-plugins` to write into the desktop's
staging directory instead, which is the one to use when iterating on a **bundled** plugin's frame under
`pnpm dev` (that directory is the copy the app trusts and reconciles from).

A malformed `acorn-plugin.config.mjs` no longer waits for a rebuild or a boot to announce itself:
`validatePluginConfig` (`@acorn/plugin-api/testkit`) runs the real manifest schema over it, and
`apps/node/test/integration/pluginSystem/pluginConfigs.test.ts` does that for every loadable plugin at `pnpm test` time.

The node restart is the step that is real rather than ritual: a loaded plugin's routes, tables and jobs
wire at init, so a rebuilt bundle is not live until the node re-runs it. Under `pnpm dev:node` node's own
`--watch` sees the rewritten bundle and restarts for you. Under the desktop, use Settings → Plugins →
Restart: it re-runs reconciliation and reloads the renderer, which is the other half — frame
contributions resolve once per session, so the client has to re-ask.

### Reloading one plugin without a restart

`POST /v2/core/plugins/:id/reload` (owner/device principal, `Idempotency-Key` required, audited) swaps
one **loaded** plugin's node half in the running process. Built-ins are refused with a 400: they are
compiled into the binary, so there is no second copy on disk to swap in, and their restart-required flow
already works.

The semantics are **candidate-then-commit**. The new bundle's `init` runs against a *buffered*
registration set rather than the live registries, because every registry here rejects a duplicate — tool
names, provider ids, capability ids — and the previous instance is still in all of them. So if `init`
throws, nothing moved: the previous instance is still registered, still serving and still holding its
database, and the failure lands as `state: 'failed'` with its `reason` on the roster row, exactly like a
contained failure at boot. The route answers **200 with `state: 'failed'`** for that, not an error — the
request did nothing wrong and nothing was lost. Only on success does the host clear the previous
registrations, run its `dispose`, close its database, revoke its context and replay the buffer.

Four properties, all deliberate:

- **A revoked context throws.** After a swap, anything reached through the previous instance's `ctx` —
  a registration, a broadcast, `storage.open()` — throws rather than writing through a plugin that is no
  longer running. `ctx.core` and `ctx.capabilities.get` stay live: they are host services that did not go
  anywhere.
- **The complete dependency graph is re-evaluated.** A candidate starts in a fresh worker realm, so
  neither the entry module nor its imports can come from the previous realm's module cache. Multi-file
  node halves therefore reload without restarting the Node.
- **Registration rollback is not schema rollback.** The candidate's `init` may open and migrate the
  plugin's database, mid-process, before it fails. The host puts every registration back; it cannot
  un-migrate. The author iterating on the plugin owns the data whose shape they just changed.
- **An invalid registration fails inside the commit window.** Two tools sharing a name, or a provider
  that fails its shape check, can only be found when the buffer is replayed — the registries are what
  validate it. The plugin then ends up unregistered and marked failed, as a contained boot failure does.
  What candidate-then-commit protects is `init` *throwing*, which is the failure a dev loop produces.

The client half is one event and no new machinery. The node broadcasts a content-free `plugins:changed`
frame; the shell re-reads the roster, re-resolves which bundle wins per plugin id — the one place the
once-per-session pin is deliberately dropped — and re-runs both contribution passes, which already
dispose-then-register. Trust is not bypassed: consent is keyed to a hash, so a plugin whose winning hash
moved to bytes this device has never accepted comes back untrusted, its code-bearing surfaces are
withheld, and the distribution pass queues the usual prompt. A plugin frame is an iframe whose ORIGIN is
its bundle hash, so a new hash is a new origin and a new document with nothing carried over.

**Boot** trust prompts are gone from development, because a development build acknowledges the bundled
first-party roster on exactly the terms a packaged build does — the same directory, read and hashed by
the helper (`packages/custody/src/plugins/bundledPluginTrust.ts`). This is parity, not a widening: a
hand-installed package, a third-party one, and anything a node serves this device still prompt. Set
`ACORN_PROMPT_BUNDLED_PLUGIN_TRUST=1` to get the prompts back when the trust flow itself is what you are
working on.

Mid-session rebuilds are not covered, and the reason is structural: the grant is made once, at helper
boot, over the bytes in the staging directory, and trust is keyed by `(pluginId, hash)`. Rebuild a client
bundle while the app is running and its new hash has never been granted, so the next registration pass
prompts — once, and not again after a relaunch. Rebuilding into the data root instead (a plain
`build:plugin`, or a package served by a paired `dev:node`) is outside the grant entirely and prompts per
rebuild by design; the marker that would let the host recognise a dev build cannot be a security signal
(`packages/node-core/src/server/plugins/bundled.ts` says why). So: iterate on a client bundle with
`--package-root` into `apps/desktop/dist/bundled-plugins` and relaunch, and a node-only change needs no
prompt at all.

Four first-party packages ship this way and none is also present in the compiled composition.
Rollbar was the first production caller of the route, descriptor and frame seams. `model-providers` is
one end of the range: node-only, no client bundle, no routes, no storage, `contributions: {}` — it
registers two connection providers and two model adapters and stops, which is proof the loaded tier
costs a small plugin nothing. Linear is the widest manifest here: a pane frame plus
a `refPanel` frame that ANOTHER plugin renders, a descriptor rail source with host-owned promotion,
declarative `contentLinks`, a command and a keybinding. HTTP is the other end from model-providers —
the only one that owns TABLES, so it is the only production caller of `ctx.storage` and of a
manifest-declared migration chain, and it also serves an `agentContexts` descriptor from its own
routes. Read it for the manifest half of the storage seam — the seam itself is shared with the compiled
tier now, so its whole node half is an `init` that opens storage and registers one route, with no
`dispose` at all. Read linear for the two surfaces rollbar does not
exercise, and read `docs/loaded-plugin-migration.md` for what all of these moves cost. The loader still supports a package id shadowing a built-in during
a staged migration; when that happens it drops the compiled copy from the graph and logs which
directory won.

## Approval-mediated install

The install route is device-gated, unmappable from a plugin frame, and audited, and none of that
changes. What exists on top of it is a way for an **agent's request** to reach the **owner's decision**.

The `plugin_request` agent tool (core-owned, `execute` tier — see
[agent-tools.md](../agent-tools.md)) takes an action (`install` / `update` / `uninstall`), a source or a
plugin id, an optional `dev` flag and one line of the agent's own reasoning. It installs nothing. It
cannot: `server/agentTools/pluginRequests.ts` imports `node:crypto`, `zod`, the tool registry and the
protocol types, and a test asserts that exact list, because the request/decision split is only a defence
for as long as that module has no installer within reach. The handler writes an in-memory row, broadcasts
a content-free `workflow:notice`, and throws `needs-trust` — a 409 to the agent, carrying a sentence
telling it to call again with the same arguments to collect the answer.

The owner sees the notice in the bell, which opens the approval dialog in the **shell's** overlay slot —
chrome a plugin frame cannot draw over. On approval **the device performs the install**, over the same
`/v2/core/plugins/*` routes Settings → Plugins uses, with its own principal. The agent never holds a
credential that can install code; a prompt-injected agent can produce a row in a queue and nothing else.

Four properties worth stating because they are easy to lose:

- **The queue rides the roster.** `GET /v2/core/plugins` carries `requests`, so there is no second route
  to remember to gate. `POST /v2/core/plugins/requests/:requestId` records the answer, is device-only by
  the same mount, and is permanently unmappable from a frame
  (`client-core/host/frames/scopes.ts`) — a frame that could post an approval would answer the very
  question that exists because an agent must not install.
- **One ask is one question.** Identical arguments resolve to the same pending row, and only the *first*
  raise rings the bell, so an agent cannot put a prompt on the owner's screen in a loop. Twenty
  outstanding requests is the cap.
- **An approval is spent once.** Collecting the decision deletes the row. A second identical call is a new
  question, not a second use of an old yes.
- **The store is in memory.** A pending request is a question waiting on someone looking at the app right
  now; a node restart is a perfectly good "no", and an hour is the expiry.

### What the owner can know before the download

The installer only validates a manifest *after* fetching and unpacking, so the first screen genuinely
cannot show one. The approval is therefore two screens, and the split is deliberate:

1. **The ask.** The action, the source string, the agent's stated reason, the dev flag. This is everything
   knowable before anything is fetched, and it is the gate on the fetch itself — a node reaching out to a
   URL an agent chose is a network action taken on an agent's say-so, so a No here means nothing is
   downloaded at all.
2. **The review.** The device installs, then reads the real manifest back off the roster and shows what
   the package declares. Install runs no plugin code — every result is `installed-restart-required` — so
   this still happens before anything executes, and its No uninstalls the package again (keeping its
   data, as every other uninstall path does by default).

The alternative — download and validate first, then approve against the real manifest — was rejected for
two reasons. It fetches on the agent's word with no human in between, and pinning the reviewed bytes
through to the install would need either a staging directory that outlives the request or a second
download that can resolve to something else. The second screen buys the same disclosure without either.

The client half of a plugin gets a third look regardless: the per-hash bundle trust prompt fires from the
next distribution pass, with the full permission diff. What screen 2 adds is the **node half**, which has
no other disclosure surface — it would otherwise start at the next restart with nobody having read what
it declared.

## Development mode

Per-hash trust is right for distribution and wrong for iteration: an agent saving a file every minute
would mean a prompt per save. So the owner makes one decision instead — approving a `dev: true` request —
and the device stores a **dev trust grant**.

The grant lives in the device's existing trust file (`packages/custody/src/plugins/pluginTrustStore.ts`),
beside the acknowledgements, as `{ pluginId, nodeId, path?, grantedAt }`. It is keyed on the **pair**.
The design note says "per (pluginId, device)" and the device half is the file itself; the node half is an
addition, because fleet resolution picks the highest version across every paired node and a grant keyed on
the name alone would auto-trust a bundle a *different* node started serving under it.

What it does: when the helper caches a bundle for a plugin under grant, it records an ordinary accepted
acknowledgement for those bytes right there — beside the hash it computed itself, in the process that
holds the grant. The renderer therefore never queues a prompt, and nothing about eligibility changes:
`bundleAccepted` and `eligiblePlugins().trusted` see an acceptance and behave exactly as they would for
one the owner clicked. A dev-written row is marked `dev: true` (so revocation can find it) and
`partial: true` (nobody read a disclosure, so it must never become the baseline of a later "what changed"
diff).

It hangs off the local-path install seam — `{ path }`, the absolute-path symlink — so the agent has an
in-place directory to iterate in, and a dev-mode install ends in a **reload** rather than a restart
prompt where the plugin is reloadable.

**Visibly different, and endable.** Settings → Plugins badges the row *in development — bundle changes are
auto-trusted* and puts an **End dev mode** button beside it. That is not decoration: the moment a dev-mode
plugin is indistinguishable from a normal install, the trust story has rotted. Ending it is one act with
two halves — the grant goes, and so does every acknowledgement the grant wrote. Without the second half
"revoke" would leave every auto-trusted hash still accepted. What survives is whatever the owner answered
by hand, so the plugin goes back to exactly where it was, and with nothing left the current bundle is
undecided again and the normal per-hash prompt asks about it on the next distribution pass. That is what
promoting a plugin out of dev mode means in practice, and revoking and promoting are the same operation.

**In a packaged build.** Dev mode widens nothing, and it no longer has to: the `{ path }` source it hangs
off is allowed on every build now ([security.md § Installing from a folder](../security.md)), so a packaged
app gets the same in-place directory a dev checkout does. The grant itself is source-agnostic and is not
gated on packaging — it is a device-side trust decision about a plugin the owner administers — so dev mode
over a remotely-sourced plugin still means only "future versions of this one do not re-prompt", and each
iteration there is still an explicit update because there is no directory to edit.

## Teaching the agent

The mechanics above do nothing on their own. An agent that has to guess at the manifest vocabulary spends
its first session finding out that `zod` will not resolve and that a second client module 404s, and the
loop is not worth entering. So the contract is served *by the node that enforces it*, through two doors
onto one text (`server/agentTools/pluginAuthoring.ts`).

The door the agent uses is the `plugin_authoring` tool — no arguments, `read` tier, and every list in its
answer derived at call time from the schema that enforces it rather than written down beside it
([agent-tools.md](../agent-tools.md) has the derivation table and the two omissions). The door a human uses
is the `plugin-authoring` **context section**, which is `defaultIncluded: false` and therefore free: a task
that is not writing a plugin never assembles it. That flag is why acorn can afford an authoring guide at
all, where bb pays for its 1,678-line equivalent on every session.

What the derivation cannot cover is process, so that half is prose: write the directory, ask with
`plugin_request { action: 'install', source: { path }, dev: true }`, expect `needs-trust`, call again with
identical arguments to collect the answer, then iterate with `action: 'update'` and the same `dev: true`
so the approval ends in a reload rather than a restart. A reload starts a fresh worker realm and
re-evaluates the complete node dependency graph, so splitting the node half does not create a
restart-only development path.

The entry point is **Settings → Plugins → Create a plugin**, which drafts that starting prompt into the
current task's agent composer through the same `sendReferenceToAgent` seam the editor and changes panes
use. A draft, not a send: the owner reads it, says what the plugin should do and presses send themselves.
It deliberately does not open a *new* task — `TaskSeed` carries no prompt field and settings has no project
in scope, so that would be a protocol field and a column for the sake of an entry point, and the existing
seam is honest about the case where there is no agent session to draft into.

## The client half of a loaded plugin

A loaded plugin's UI is not registered by its own code. The Node hands each device the plugin's
manifest and the hash of its client bundle in the roster (`GET /v2/core/plugins`); the device
decides what to render from that, and the plugin's JavaScript never touches a shell registry.

Five kinds of contribution come out of that one manifest, and each has its own section below:
frames, remote trees, document surfaces, webviews, and descriptors. The wire format behind the
second one is in [The tree contract](descriptors.md#the-tree-contract).

**When the device asks.** Every host draws before the node it just started is up, so the pass that reads
the fleet's rosters, caches the bundles and registers those contributions cannot run from a composition
root: at that moment the fleet list is still empty and every node reads `offline`, and the pass asks
nobody. `watchPluginChanges` (`host/plugins/reload.ts`) owns it instead, and runs it the first time each
node becomes reachable — once per node, so a connection that flaps does not re-hash the fleet's bundles.
The same watcher then keeps it reconciled for the rest of the session, off the node's `plugins:changed`
broadcast. Both hosts call it and neither runs a pass of its own.
