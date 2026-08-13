# 01 — Carry every plugin failure across the seam

**Strength: Strong. Do this one first.**

## The problem, plainly

When a plugin fails to load or start, the person looking at the app should be told what happened.
Today they are told the wrong thing, a generic thing, or nothing at all — and the real answer is
one `console.error` line in the node child process's stdout, which the packaged desktop app shows
to nobody.

This is the single worst debugging trap in the plugin system, and it hits every author on both
tiers the first time anything goes wrong. Anything going wrong is the normal state of plugin
development, so this is the first wall every author walks into.

## What happens today, failure class by failure class

The load pipeline produces precise failure records and then drops them, at different points
depending on the class of failure:

**Class 1 — scan/load failures (bad manifest, wrong API version, bundle fails to import).**
`packages/node-core/src/main/pluginLoader.ts` builds a `PluginLoadFailure { id, dir, reason }` for
each, with eight distinct reason strings (missing/invalid manifest, apiVersion mismatch, duplicate
id, escaping paths, import error, wrong default-export shape, name/id mismatch). Every failure is
printed once at `pluginLoader.ts:330` via `console.error` — and then discarded.
`apps/node/src/server/composition.ts:39` destructures only `{ loaded, installed }` from the loader
result; the `NodeComposition` type (`composition.ts:20-29`) has no `failures` field. Nothing
carries these to a route, the roster, or the client.

The knock-on effect is the trap: a package whose bundle throws on import still appears in
`scanInstalled` (that pass only reads manifests) but is absent from `booted()`. The roster route,
`packages/node-core/src/server/routes/plugins.ts:149-160`, classifies that combination as

```ts
const waiting = entry.hasNode && !off && booted.get(entry.id) !== entry.version
rows.push({ ..., state: off ? 'disabled' : waiting ? 'pending-restart' : 'active' })
```

so Settings → Plugins shows the plugin as **"waiting for a restart"**, with a Restart node banner
(`restartRequired`, `:165`) — and restarting never clears it, because restarting re-runs the same
failing import. The UI is not silent here; it is confidently wrong.

**Class 2 — init/ready failures in a loaded plugin.** These are contained properly:
`packages/node-core/src/server/plugin/host.ts:96-105` (`contain()`) rolls back registrations,
disposes, and records `{ name, error: <the real message>, at }`. But `PluginRosterEntry`
(`host.ts:53-62`) carries only `name/required/disabled/state/failedAt` — **no error field**. So the
message dies inside the process. The client's attention item is hardcoded generic prose
(`packages/client-core/src/node/pluginFailures.ts:28`: "It is installed on this node but its
start-up threw…") and the Settings page renders the bare string `failed to start`. An author whose
plugin threw `TypeError: Cannot read properties of undefined (reading 'load')` — the exact shape an
undeclared core facet produces, by design (`pluginPermissions.ts:12-15` gates by omission) — sees
none of that text anywhere in the UI.

**Class 3 — client-side failures.** A frame bundle that throws at module scope renders a blank
iframe: `packages/client-core/src/plugins/frames/PluginFrame.tsx:250-303` adds only a `load`
listener and posts the port; there is no handshake timeout and no error handler. A contribution
that fails to register (duplicate pane id, for example) is swallowed into `console.warn`
(`frames/register.tsx:120-124`) — the pane simply does not exist, with no signal.

**Class 4 — reconciliation.** `apps/node/src/service/runtime.ts:98-109` logs `installed`,
`updated`, `preserved`, and `failures` — but never `removed`. A bundled plugin that was uninstalled
once (tombstone via `pluginInstaller.ts:432`) silently never comes back on any future app version,
with zero output anywhere.

Also worth naming: a bad manifest collapses every Zod issue into one sentence.
`readPluginManifest` (`pluginManifest.ts:801-810`) deliberately never throws and returns `null`, so
the loader can only say "acorn-plugin.json is missing, unreadable, or does not match the manifest
schema" — no field path, no hint which of ~30 rules failed.

## Why the fix belongs to the host

The host already wrote the principle down. `packages/client-core/src/node/pluginFailures.ts:8-10`:

> Core-owned rather than plugin-contributed … the plugin that failed is by definition not running
> to speak for itself, and the state belongs to the node rather than to any one plugin.

That is exactly right — and then the seam only carries one failure class (class 2), and drops the
message even for that one. The roster models plugin state as
`active | disabled | pending-restart | failed` when the real state space includes
failed-to-parse, failed-to-import, wrong-api-version, id-conflict, contained-with-reason,
surface-skipped, and frame-dead.

## The change

All additive. No plugin changes, no manifest changes.

1. **Keep loader failures.** Add `failures: readonly PluginLoadFailure[]` to `NodeComposition`
   (`apps/node/src/server/composition.ts`) and thread it from `loadExternalPlugins` through to
   wherever the roster route gets its data.
2. **Widen the roster row.** Add optional `reason?: string` (and consider `stage?: 'load' | 'init'
   | 'ready'`) to `PluginRosterEntry` (`host.ts:53-62`) and the wire type the roster route serves.
   Populate it from `contain()`'s recorded error and from the loader failures. A load-stage failure
   should serve `state: 'failed'` with its reason — not `pending-restart`.
3. **Render it.** `pluginFailureAttention` (`pluginFailures.ts:20-34`) already polls the roster and
   filters `state === 'failed'`; put `row.reason` into the attention item's `detail` instead of the
   hardcoded sentence. Same for the Settings page (`PluginsSettings.tsx` around line 261).
4. **Manifest errors carry their Zod paths.** Give `readPluginManifest` a second return shape (or a
   callback) that surfaces `issue.path + issue.message`, and put that in the failure reason. The
   author should read "contributions.commands[2].run: openPane must name a task-scoped pane this
   manifest declares", not one collapsed sentence.
5. **Frames fail visibly.** Give `PluginFrame` a handshake deadline (the SDK's `connect()` posting
   back is the natural ack). On timeout, swap in the placeholder the broker's rate-limiter path
   already renders (`broker.ts:163-190` has the pattern) with "this plugin's UI failed to start".
   Promote `frames/register.tsx:120-124`'s swallowed warns into the same channel.
6. **Log `removed`** in the reconciliation summary at `runtime.ts:98-109`.

## What it looks like afterwards

An author ships a broken bundle. The bell shows "Plugin linear failed to start — could not import
node/index.js: SyntaxError: …", stamped when it happened. Settings → Plugins shows the same reason
on the row. A broken frame shows a labeled placeholder instead of a blank rectangle. Nobody greps
stdout.

## Notes for whoever picks this up

- The wire type change: keep new fields optional. There is a repo gotcha about the
  IndexedDB-persisted query cache — if a persisted response type gains a *required* field, the
  query key must be bumped. Optional fields avoid the whole question.
- Failure text crosses the trust boundary from a loaded plugin's thrown error into the owner's UI.
  It is display-only; render it as text, never as markup, and consider capping its length.
- The dogfood test to extend: `apps/node/test/integration/pluginLoader.test.ts` already builds a
  real package and loads it. Add a case that corrupts the bundle and asserts the failure appears
  on the roster route with its reason, and that its state is `failed`, not `pending-restart`.
- `docs/plugins.md` documents the roster/attention behavior; update it when the contract changes
  (that is the repo rule).
