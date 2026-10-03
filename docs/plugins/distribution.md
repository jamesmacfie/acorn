# Distribution

This page covers how loaded packages are built and bundled with the app, how a Node's running
identity differs from its disk, and how each device decides which bundle to register. It's part of
the [plugin reference](../plugins.md).

## Bundled packages

`apps/node/scripts/build-plugin.mjs` builds a repository plugin into a loaded package. It reads the
plugin's declaration from `plugins/<id>/acorn-plugin.config.mjs`, where the directory name is the
plugin id, so the declared surface is reviewed beside the code it describes. Its default target is
the development data root. `--package-root` stages the same package for distribution.

`apps/desktop/scripts/build-bundled-plugins.mjs` holds the bundled roster: agent-cost, database,
http, linear, model-providers, rollbar, and sentry-telemetry. The desktop packages the result as
read-only application resources and asks the Node to reconcile it before discovery:

- The Node updates only packages recorded as app-owned.
- An owner-installed version wins.
- Uninstall writes a tombstone outside the package directory, so a later app update doesn't restore
  the plugin.
- An unrecorded directory in the plugin root counts as owner-installed, with one exception. A
  package `build:plugin` wrote into the data root has a `.acorn-dev-build` marker, and reconciliation
  treats a marked package as app-owned, so a newer bundled version replaces it.

`build:plugin` never writes the marker under `--package-root`, so no shipped resource carries it.
Because an owner-installed row is still checked first, `build:plugin` also clears a `user` row for
the id it writes. Under `--package-root` it can't clear that row, so it prints the row, the file, and
the fix instead. Both Node hosts report every ownership row at boot (`reconcileBundledPackages` in
`apps/node/src/composition/composition.ts`).

The desktop helper trusts bundled client bytes only after it reads and hashes its own application
resource directory. A Node can't gain that trust by labeling a roster row as bundled.

A bundled package has no lockfile, so its update route can only refuse. The roster row says so with
`installed.bundled` on `InstalledPluginRow`, and the plugin's page shows neither **Update** nor
uninstall. The **Enabled** switch covers "stop running this" without leaving a tombstone.

## Running identity, distribution, and availability

The roster separates the `installed` disk candidate from `active`, the declaration captured when the
Node's loaded runtime started. `active` includes the version, permissions, contributions, API
version, activation kind, and client hash. Installing, updating, or uninstalling changes the disk,
not the running node half. A live reload commits a new active identity only after the replacement
initializes, and a failed reload keeps the old one. The Node keeps active bundle bytes apart from the
package directory and serves `GET /v1/core/plugins/:id/bundles/:hash` for that identity, even after an
update or uninstall on disk. A client-only package can replace its active identity without a restart,
because it has no node half.

The client holds one distribution snapshot for the fleet. Each Node's last valid roster is an
observation with freshness and reachability:

- A plugin event re-reads only the Node it came from. Arrival, reconnect, switch, and unpair also
  reconcile.
- Reads and trust refreshes run in a serial queue, and a response from an unpaired Node can't
  restore its authority.
- An unreadable Node keeps a stale observation for explanation but contributes no live UI.

There's no fleet-wide version winner. The active Node's registrations come from its own running
identity. An installed update is an offer to cache and review, not a replacement.

A compatible device-held bundle takes precedence for its plugin id, even when the active Node
reports a newer version. Disabling that device bundle, or withholding trust from it, withdraws its
contributions without exposing the Node's bundle under the same id.

## Trust on the device

Device custody hashes the bytes it receives and stores decisions for exact `(pluginId, hash)` pairs,
bound to the permissions, contributions, API version, and emitted events approved with those bytes.
Caching alone grants nothing:

- A pending or rejected update leaves an accepted older runtime visible while it still runs.
- When the Node commits bytes this device hasn't accepted, the plugin's loaded UI is withheld until
  acceptance.
- A changed declaration under the same hash also withholds the UI and asks for review. Older
  approvals without a declaration binding prompt again.
- Trust writes complete before registrations change. Revoking an acceptance or ending a development
  grant withdraws the affected registrations and stops their workers at once.
- Dismissing a prompt decides nothing durable, and the plugin stays under **Needs you**.
  Reconsidering a rejection removes that recorded decision so the offer can be reviewed again.

The snapshot gives a structured reason for withheld UI: unknown or unreachable Node, absent,
disabled, or failed runtime, waiting for restart, missing bundle, incompatible API, declaration
conflict, pending trust, or rejection. Loaded panes, settings, importers, footer slots, commands, and
other declarations use those reasons. A compiled contribution with a `{ plugin: id }` requirement
checks that Node's running service instead, so a saved disable that waits for a restart doesn't hide
a compiled service that's still running.

An older Node omits `active`. The client accepts an older row only when `running` and its installed
declaration describe an active package. Pending, failed, and disabled rows are withheld.

[Third-party plugin bundles](../security/plugin-bundles.md) owns the threat model behind these rules.

## One shared eligibility and trust check

The frame and chrome registration passes need the same answer to "who may contribute, and what did
they declare". `packages/client-core/src/host/plugins/contributions.ts` owns that answer, and the
passes keep their own jobs: drawing a sandboxed iframe or registering a command. One copy matters
here, because it feeds the `openPane` allowlist, the list of pane ids a sandboxed frame may ask the
host to open.

`eligiblePlugins()` reads the active Node's observation and pairs its running declaration with that
Node's selected hash. `trusted` is true only when custody has cached and accepted the exact client
bytes of the active runtime. A declaration with no client half can still contribute host-drawn
descriptors. Command and keybinding metadata may stay visible for an inactive plugin so saved
bindings can be explained, but invocation checks current availability.

Frames gate code-bearing surfaces on `trusted`. Chrome asks the weaker `hasWithheldCode`: does this
package carry code the device hasn't cleared? A descriptor-only package has no such code, so its rail
rows and commands register.

`declaredSurfaces()` sorts a manifest's frames into three separate sets: `panes`, the task-scoped
surfaces and the `openPane` allowlist, `projectPanes`, a rail source's detail view addressed by URL,
and `overlays`, full-screen pickers that belong to no task. The task-scoped test comes from
`@acorn/protocol/plugin/contract.ts`, the same one the Node's manifest parser uses.
