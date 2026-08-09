# Moving built-in plugins to the loaded-plugin shape

acorn has two plugin tiers (docs/plugins.md). Five of the seventeen built-ins use nothing the
loaded tier cannot give them — they are compiled in because they were written before the loader
existed, not because they need to be. This folder is one file per candidate, written for whoever
picks the move up.

| Plugin | Blockers | File |
| --- | --- | --- |
| rollbar | none | [rollbar.md](./rollbar.md) |
| linear | none | [linear.md](./linear.md) |
| http | `agentContexts` has no manifest form | [http.md](./http.md) |
| database | `agentContexts`; and decide whether the pane is a frame or stays first-party | [database.md](./database.md) |
| editor | Monaco in a frame; the component slot | [editor.md](./editor.md) |

`docs/first-party-plugins.md` is the audit these five fall out of — read it for why the other
twelve stay put.

## Read this before starting one

**The point is not to have fewer built-ins.** Working integrations moved for tidiness buy
nothing and risk a regression each. There are exactly two good reasons to do one of these:

1. **To exercise the loaded tier with something real.** Every gap the third-party audit found
   existed because no production plugin walked those paths — the fetch route seam shipped with no
   caller, and still has none. A built-in that moves becomes the standing proof that install →
   distribute → trust → run works, and stays proof, because it is something people use rather
   than a fixture.
2. **Because the plugin genuinely wants to ship on its own cadence** — a provider whose API
   changes more often than acorn releases.

If neither applies, leave it alone. Each file below says what its own best reason is.

**Do at most one first.** These are instances of the same experiment; running them in
parallel means several half-migrations and no answer. Rollbar is the recommended first move (smallest
surface, no tables, no capabilities) and its file carries the most detail. The others assume you
have read it.

**A moved plugin is a new plugin.** Do not rewrite a built-in in place and flip a switch. Build
the loaded version alongside, run both, cut over when the loaded one is better, then delete the
built-in. The built-in staying green throughout is what separates "the seam works" from "the port
compiled".

## What every move involves

Common to all of them; the per-plugin files only cover what differs.

**Manifest** (`acorn-plugin.json`) — `id`, `version`, `apiVersion`, entrypoints, and the
`permissions` block. The node facets are the ones to get minimal: declare what the plugin calls,
not what it might. Rung 1 gates by omission, so an undeclared facet is a `TypeError` on first call
and you will find it immediately (docs/security.md § Node-half plugin security).

**Routes** — `ctx.routes.register` (Hono) becomes `ctx.routes.fetch(handler)`, a
`(Request, PluginRequestContext) → Response`. Integration providers pass a fetch handler to
`ctx.providers.integration` too; passing Hono is an explicit init error. The request context
carries the authenticated identity and a provider runtime, so provider resource and connection
operations work without Hono, the core database, or the secret service.

**Client surfaces** — panes, ref panels and settings pages become `frame` targets declared in the
manifest, rendered in a sandboxed iframe on `app-plugin://<hash>`. Rail sources, badges, palette
rows, attention items and node stats become descriptors: static data plus a route in the plugin's
own namespace, drawn natively by the host. Anything that was a callback becomes either a bridge
verb or a route.

**Storage** — a plugin that owns tables declares a package-relative `migrations` directory and
opens through `ctx.storage.open()`. Its SQLite filename is bound from the manifest id, so the id
must not change during a move or the data is orphaned.

**Build and install** — one ESM bundle per half, deps inlined, `@acorn/plugin-api` consumed as
types. `apps/node/scripts/build-plugin.mjs` is the dev path; the real one is
`POST /v2/core/plugins/install`.

## The shared blockers

None of these is a law; all are carriers that have not been built.

**`agentContexts`** — the composer's "attach this to the agent's context" picker. The contract is
already the right shape to cross a boundary:

```ts
options(scope: { taskId, workspaceId? }): Promise<AgentContextOption[]>
capture(scope, optionIds?): Promise<AgentContextSnapshot[]>
```

Async in, plain data out, no components. A manifest form is nearly mechanical — two routes in the
plugin's namespace and a descriptor naming them. The one wrinkle is `revision?()`, which is
synchronous and used for cache invalidation; fold it into the options response or let the existing
invalidation ping cover it. Blocks http and database.

Note this is only the *user-picked* half of context. Node-side context sections
(`ctx.contextSections.register`) are already open to loaded plugins with no gate, so a plugin that
wants to contribute context unconditionally can do it today.

**`persistedState`** — a client-side store slice. Frames get `state.get`/`state.set` over the
bridge instead, scoped to `plugin:<id>:*` and capped at 1 MiB, which is the same namespace the
plugin's node half sees through the `prefs` facet. For these candidates the bridge verbs are
enough; none of them needs a shell-level slice.

**`keybindings`** — no longer a blocker. A plugin declares `commands` and `keybindings` in its
manifest, existing bindings win every conflict, the user can rebind or unbind any of it in
Settings → Shortcuts, and a frame forwards chords it has not claimed to the shell dispatcher
(`docs/command-palette-and-shortcuts.md`). Open review items:
[docs/keybindings/](../keybindings/).
