# 02 — A host-owned dev loop: rebuild, reconcile, and trust without ritual

**Strength: Strong.**

## The problem, plainly

To see a one-line change to a loaded plugin running in the app, an author today must: rebuild the
package by hand, restart the node, reload the renderer, and click through four trust dialogs. And
if their copy of the plugin ever acquired a "user" ownership row — which happens by accident — it
silently stopped receiving updates, and nothing in the dev workflow says so.

None of this is knowledge about *their plugin*. It is knowledge about how the host builds,
distributes, and trusts packages. That is host property leaking into every author's day.

## What happens today

**There is no watch mode.** No plugin package has a `build` script at all (all 17 `package.json`
files carry only `lint` and `test`), so `turbo run build` never touches them. The only builder is
`apps/node/scripts/build-plugin.mjs`, a standalone script, and it tells you the rest of the loop
itself — line 213 prints `[build-plugin] restart the node to load it`. The renderer half is worse:
frame contributions sync once at boot and once after a trust decision
(`packages/client-core/src/plugins/distribution.ts:127-130` resolves `activeBundles` once per
session), so after the node restart you also reload the renderer.

The watch loops that do exist don't help: `pnpm --filter @acorn/desktop electron:dev` watches the
shell but skips `build:service` and `build:bundled-plugins`, so plugin changes are invisible under
it. `pnpm dev:node` hot-restarts the host's own TypeScript but plugins are pre-built bundles the
watcher cannot rebuild.

**`dev:node` never reconciles.** `apps/node/src/server/standalone.ts` — the entry for `pnpm
dev:node` and the packaged standalone node — never calls `reconcileBundledPlugins`. Only the
supervised host does (`apps/node/src/service/runtime.ts:96`). So under the loop developers use
most, whatever the last manual `build:plugin` left in `<dataRoot>/plugins/<id>/` runs forever, and
the "bundled packages NOT updated" warning the supervised host prints does not exist.

**The `user` ownership row is sticky and easy to acquire.**
`packages/node-core/src/main/bundledPlugins.ts:118-121` short-circuits reconciliation for any
plugin whose state row says `user` — before the `.acorn-dev-build` marker is even checked
(marker check at `:146-154`). You get a `user` row from:

- `installPlugin` (`pluginInstaller.ts:392`),
- a `{ path }` dev link (`pluginInstaller.ts:415`),
- or reconciliation itself, whenever a target directory exists with no matching `installed` row or
  a drifted fingerprint (`bundledPlugins.ts:156-160`) — i.e. a hand-copied directory.

The only escape is `build-plugin.mjs:199-209`, which deletes the row — and only when
`--package-root` is absent. A frozen copy's one trace is a single log line in the supervised host
(`runtime.ts:105`), absent entirely under `dev:node`.

**Trust prompts stack four deep on every dev and e2e boot.** Auto-trust of bundled first-party
client bundles runs only in packaged builds — `apps/desktop/src/app/main/bootstrap.ts:115`:

```ts
if (app.isPackaged) trustBundledClientPlugins(bundledPluginsDir, app.getVersion(), pluginCache, pluginTrust)
```

In dev and e2e, `app.isPackaged` is false, reconciliation still installs all five bundled packages,
and four of them ship client bundles (`BUNDLED_PLUGINS = ['database','http','linear',
'model-providers','rollbar']`; only model-providers has no client half). Trust is per
`(pluginId, hash)` per device (`pluginTrustStore.ts:70-72`), and e2e uses a fresh device dir every
run — so every run re-prompts four times, and every rebuild that changes any byte of a frame
re-prompts in dev too. `apps/desktop/e2e/rollbarLoaded.spec.ts:168-182` carries a 60-second
answer-all-prompts loop to survive this, and the standing-issues list in
`docs/third-party/README.md` already names the ~dozen wedged specs.

## Why it matters, simply

Fast feedback is the whole point of a plugin seam. If seeing a change takes minutes of ritual and
tribal knowledge (ownership rows, hash-scoped trust, which entry point reconciles), authors either
stop iterating or stop using the seam. Every piece of that ritual is something the host already
knows how to do — it just doesn't do it on the author's behalf in development.

## The change

Host side, all dev-scoped:

1. **A watch mode.** One command (a `--watch` flag on `build-plugin.mjs`, or a `dev:plugin <id>`
   script) that watches the plugin's `src/` and `acorn-plugin.config.mjs`, re-runs the builder into
   the data root, and nudges the running node/renderer to reload. Even without hot reload, "save →
   it rebuilt and told the node to restart" removes most of the ritual.
2. **Reconcile in standalone.** Call `reconcileBundledPlugins` (behind the same
   `bundledPluginsDir` config) from `standalone.ts`, and print the same summary the supervised
   host prints — including `preserved`, so a frozen copy announces itself in the dev loop.
3. **Dev parity for trust.** In non-packaged builds, auto-trust exactly the same set packaged
   builds auto-trust: the bundled first-party roster. This is parity, not a widening — third-party
   and hand-installed packages still prompt. (An env-var opt-out for anyone testing the trust flow
   itself.)
4. **Make the `user` row escapable and visible.** At minimum log it in both roots; better, have
   the builder clear it in the `--package-root` case too, or print how to clear it.

Plugin side afterwards: edit source, see it running. That's the entire contract.

## Notes for whoever picks this up

- Keep the trust change scoped to the bundled roster. The trust store is a real security boundary;
  the argument for auto-trust in dev is only that packaged builds already extend it to these exact
  first-party artifacts (`bundledPluginTrust.ts`).
- The renderer half of reload: `syncPluginDistribution().then(syncFrameContributions…)` runs at
  boot (`apps/desktop/src/app/client/index.tsx:53`) and after trust decisions. A dev reload can
  reuse that path; `registerSurfaces` already returns disposables and replaces a plugin's set on
  re-run (`frames/register.tsx:52`), so client-side re-registration is designed for.
- The node half genuinely needs a restart today (routes/tables/jobs wire at init —
  `routes/plugins.ts:22-25` documents why). Don't fight that; make the restart automatic instead.
- A scaffold/generator is deliberately out of scope — `docs/extensibility.md` puts ecosystem
  tooling last. This item is about the 17 in-repo plugins that pay the cost now.
- Related standing issue: "multiple bundled plugins raise multiple boot trust prompts" in
  `docs/third-party/README.md § Known issues` — fixing trust parity closes that at the root.
