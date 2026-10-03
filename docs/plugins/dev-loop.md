# The dev loop

This page covers how to see a change to a repository plugin run: rebuilding, reloading one plugin
without a restart, and trust prompts during development. It's part of the
[plugin reference](../plugins.md). A hand-written package has no build step and is installed as a
link, so its loop is in [plugin authoring](../plugin-authoring.md).

## The dev loop

Run these two commands for a repository plugin:

```sh
pnpm dev:plugin rollbar     # rebuild the package on every save
pnpm dev:node               # restart the Node when the bundle changes
```

`pnpm dev:plugin <id>` (`apps/node/scripts/dev-plugin.mjs`) watches the plugin's `src/`, its
`acorn-plugin.config.mjs`, and its migration chain, and re-runs `build-plugin.mjs` in a fresh process
on each change. It builds into the development data root by default. To iterate on a bundled
plugin's client under `pnpm dev`, pass `-- --package-root ../desktop/dist/bundled-plugins`, the
staging directory the app trusts and reconciles from.

For a plugin that depends on the workspace `acorn-plugin-sdk`, `build-plugin.mjs` builds the SDK first,
because its package exports resolve to generated `dist/` files.

`validatePluginConfig` from `@acorn/plugin-api/testkit` runs the real manifest schema over an
`acorn-plugin.config.mjs`. `apps/node/test/integration/pluginSystem/pluginConfigs.test.ts` does that
for every loadable plugin, so a bad declaration fails in `pnpm test` and not at the next boot.

A loaded plugin's routes, tables, and jobs wire at init, so a rebuilt bundle isn't live until the
Node runs it again. Under `pnpm dev:node`, Node's own `--watch` sees the rewritten bundle and
restarts. Under the desktop, use **Restart node** in **Settings > Plugins > Installed**. It re-runs
reconciliation and reloads the renderer, because frame contributions resolve once per session.

### Reloading one plugin without a restart

`POST /v1/core/plugins/:id/reload` takes an owner or device principal, requires an
`Idempotency-Key`, and is audited. It swaps one loaded plugin's node half in the running process.
Compiled plugins get a 400, because there's no second copy on disk to swap in.

The reload runs candidate, then commit. The new code's `init` runs against a buffered registration
set, not the live registries, because every registry rejects a duplicate and the previous instance is
still in all of them. If `init` throws, nothing changes: the previous instance keeps serving and
holding its database, and the roster row shows `state: 'failed'` with its `reason`. The route answers
200 with `state: 'failed'`, because the request did nothing wrong. Only on success does the host
clear the previous registrations, run its `dispose`, close its database, revoke its context, and
replay the buffer.

The host owns every candidate. An unknown or disabled owner closes the unstarted realm. An
initialization, replay, or `ready` failure disposes the candidate, closes its worker storage, ends
its realm, and revokes its context, and keeps the reported failure if disposal also throws. An
initialization failure leaves the previous instance serving. A replay or `ready` failure follows the
contained-failure rules, because commit has begun.

Four properties to know:

- **A revoked context throws.** After a swap, a registration, broadcast, or `storage.open()` through
  the previous instance's `ctx` throws. `ctx.core` and `ctx.capabilities.get` stay live.
- **The whole dependency graph is evaluated again.** A candidate starts in a fresh worker realm, so a
  multi-file node half reloads without a Node restart.
- **Registration rollback isn't schema rollback.** A candidate's `init` may migrate the plugin's
  database before it fails. The host puts every registration back but can't undo the migration.
- **An invalid registration fails inside the commit window.** Two tools sharing a name, or a provider
  that fails its shape check, shows up only when the buffer is replayed. The plugin then ends up
  unregistered and marked failed.

The client half needs no extra machinery. The Node broadcasts a content-free `plugins:changed`
frame, and the shell re-reads that Node's roster and re-runs both contribution passes. Trust isn't
bypassed: consent is keyed to a hash, so a plugin whose active hash moved to bytes this device hasn't
accepted comes back untrusted and the usual prompt is queued. A frame's origin is its bundle hash, so
a new hash is a new origin and a new document.

## Trust prompts in development

A development build accepts the bundled first-party roster on the same terms a packaged build does:
the helper reads and hashes the staging directory at boot
(`packages/custody/src/plugins/bundledPluginTrust.ts`). A hand-installed package, a third-party
package, and anything a Node serves this device still prompt. Set
`ACORN_PROMPT_BUNDLED_PLUGIN_TRUST=1` to get the bundled prompts back when you're working on the
trust flow.

The grant is made once, at helper boot, over the bytes in the staging directory, and trust is keyed
by `(pluginId, hash)`. Rebuilding a client bundle while the app runs gives it a hash that was never
granted, so the next registration pass prompts once. Rebuilding into the data root instead, with a
plain `build:plugin` or a package a paired `dev:node` serves, is outside the grant and prompts on each
rebuild. The development marker can't be a security signal
(`packages/node-core/src/server/plugins/bundled.ts` says why).

So iterate on a client bundle with `--package-root` into `apps/desktop/dist/bundled-plugins` and
relaunch. A change to the node half alone needs no prompt.
