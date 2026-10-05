# The dev loop

This page covers how to see a change to a repository plugin run: rebuilding, reloading one plugin
without a restart, development mode for a folder plugin, and trust prompts during development. It's part of the
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
200 with `state: 'failed'`, because the request did nothing wrong. After `init` and `ready` succeed, the host
clear the previous registrations, run its `dispose`, close its database, revoke its context, and
replay the buffer.

The host owns every candidate. An unknown or disabled owner closes the unstarted realm. An
initialization, `ready`, or replay failure disposes the candidate, closes its worker storage, ends
its realm, and revokes its context, and keeps the reported failure if disposal also throws.
Initialization and `ready` run before commit, so those failures leave the previous instance serving.
A replay failure follows the contained-failure rules after commit has begun.

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

## Development mode for a folder plugin

A node plugin installed from a local folder can run in development mode. Turn it on under
**Settings > Plugins > Installed**, on the plugin's **Permissions** tab, in **Development mode**. The
switch is offered only for a folder install with a node half, because a downloaded version should
always be reviewed. The node refuses `PUT /v1/core/plugins/:id/development` for anything else.

While it's on, the node does four things (`packages/node-core/src/server/plugins/development.ts`):

1. It polls the manifest and the built `node` and `client` files every 250 ms. Half a second after
   the last change, it reloads the plugin through the reload path above. Reloads of one plugin run
   one at a time, whether a save or the reload route asked.
2. It keeps the plugin's last 500 `ctx.log` lines in memory. The plugin page gains a **Logs** tab
   that reads them from `GET /v1/core/plugins/:id/logs`.
3. It approves what the plugin's derived sources read with a development grant, written again before
   each reload so a changed input list doesn't ask on every save.
4. It adds diagnostics to each run of the plugin's derived sources: each input's read time, the
   plugin's own time, and up to 20 dropped records with the field and the problem. A panel reads the
   source fresh on every run instead of reusing the five-second shared read, because the plugin's
   logic can change without its revision changing.

A loader, `init`, or `ready` failure before commit keeps the previous version serving. A buffered
registration failure during replay can leave the plugin unregistered because the host has already
retired the old instance ([reload limits](#reloading-one-plugin-without-a-restart)). The roster row shows
`state: 'failed'` with the reason. If the loader refused the new files,
such as a bundle that doesn't import, the reload never reaches the host, so development mode puts
the same failure on the row. The row's status reads "In development. Reloads when its files change."

Turning it on also sets this device's dev grant for the plugin on that node, so a rebuilt client
bundle is trusted without a prompt ([trust prompts in development](#trust-prompts-in-development)).
Turning it off stops the watch, drops the log lines, and removes the development grant. The person
then approves what the plugin reads again, even if they had approved it before development mode
replaced their grant.

The list of plugins in development mode lives in `development-plugins.json` in the data root, so a
restarted node watches again. An uninstall ends development mode first. Turning it on and off is
audited as `plugins.development.started` and `plugins.development.stopped`. The reloads it runs on
each save aren't audited one by one.

In the panel studio, a panel that reads a source in development shows a strip with what the last run
read and dropped ([develop one against real data](../data-sources/derived-sources.md#develop-one-against-real-data)).

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
