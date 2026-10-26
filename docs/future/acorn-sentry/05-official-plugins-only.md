# Phase 5: only official plugins

Date: October 26, 2026, from the October 17, 2026 plan. Status: done. Depends on
[phase 4](./04-ship-the-dsn-in-release-builds.md).

## Completion note

Landed on October 26, 2026.

What landed:

- `TelemetryBatch` has `official: readonly string[]`, in `packages/plugin-types` and in protocol's
  schema. The collector holds the list and puts it on every batch. `setOfficialTelemetryOwners` sets
  it.
- The loader marks a loaded plugin `official` when it's bundled (an `installed` ownership row and no
  lockfile), doesn't shadow a built-in, and still hashes to the fingerprint that row recorded
  (`matchesBundledFingerprint` in `bundled.ts`). The flag rides on `LoadedPluginBinding`.
- The plugin host publishes the compiled-in plugins plus every official binding. It does this once
  at boot, after each reload commit, and after an uninstall.
- The team's target carries `officialOnly: true`. With it, the exporter keeps only records whose
  owner is `core` or in `official`, after redaction and before envelope building. A connection and
  `ACORN_SENTRY_DSN` get every owner's records.
- The test kit takes `official: true` to name the plugin under test in the list. The published
  surface snapshot gained `TelemetryBatch.official`.
- Docs: a section named "Only official plugins" in `docs/integrations/sentry/the-acorn-teams-dsn.md`,
  a paragraph on the batch's fields in `docs/telemetry/plugins-and-sinks.md`, and the test kit option
  in `docs/plugin-authoring/testing.md`. On the site, one or two sentences each on the Sentry
  telemetry, Telemetry and privacy, and Privacy policy pages.

Decisions and deviations:

- The exporter keys off an explicit `officialOnly` on the target, not `settings === TEAM_SETTINGS`.
  The flag says what it does, and an identity check on a settings object would break the first time
  someone copied it.
- The loader hashes each bundled package again at every load instead of trusting the ownership row.
  The row is written at boot, and a package can be edited after that and then reloaded. That's one
  extra hash per bundled package per load, eight packages on the bundled roster.
- Records are judged one at a time, so a mixed trace keeps its core spans and loses the plugin's,
  with no re-parenting. An error in core that a bad plugin caused arrives as `core` and goes. So does
  the loader's own failure line when a shadowing package throws on load, because core's `plugins`
  logger writes it.
- The exporter doesn't count what it drops for being unofficial. A `sentry.dropped` reason for it
  would be easy to add if anyone wants to see the volume.
- A client-only plugin compiled into the renderer has no node half, so it isn't in the list, and its
  records don't reach the team. Every literal owner the renderer uses today is `core` or a node
  built-in such as `agents`, so nothing is lost.
- The desktop helper runs its own collector with an empty list. Its records go to the node, which
  holds the real list, so that doesn't matter.

Checked by tests only: the collector's list on batches, the loader's flag against a real reconcile
(bundled, shadowed, then edited), the host's list through boot, reload, and uninstall, the
exporter's filter on a mixed trace, and the plugin's team path with an unofficial owner. No release
build or live Sentry project was used.

For later phases:

- When official plugins move to their own repository, change the loader's test for `official` to
  read the installer's lock file for the acorn organization's releases. Nothing else needs to move.
- The two arch-test failures from the base commit remain: links to the deleted workflows gaps doc.

## Goal

With the built-in DSN, only records owned by core or by an unmodified official plugin reach the
team's project. A half-built plugin someone installed shouldn't fill it with its own errors.

## Starting point

Every record carries `attrs.owner`, `core` or a plugin id, stamped by the host. A plugin can't set it
([writing telemetry from a plugin](../../telemetry/plugins-and-sinks.md#writing-telemetry-from-a-plugin)).

A plugin id alone doesn't prove a record is official. A folder install can take the id `linear` and
load instead of the bundled one (`shadowsBuiltin` in
`packages/node-core/src/server/plugins/loader.ts`). Someone editing the bundled package turns it
user-managed (`packages/node-core/src/server/plugins/bundled.ts`). Both still stamp `linear`.

## Steps

Core knows where each plugin came from, and the sink doesn't. So core decides.

1. Add `official: readonly string[]` to `TelemetryBatch` in
   `packages/plugin-types/src/contracts/telemetry.ts` and its schema in
   `packages/protocol/src/runtime/telemetry.ts`. Core fills it with the compiled plugins, and the
   loaded plugins that are bundled, aren't shadowed, and still match the bundled fingerprint.
2. Recompute it on every plugin load, reload, and uninstall.
3. In the exporter, after redaction and before envelope building, drop records whose owner isn't
   `core` and isn't in `official`. Apply this only to the built-in DSN.

Two edge cases:

- **Mixed traces.** When a trace starts in core and passes through an unofficial plugin, keep the
  core spans and drop the plugin's. Re-parent nothing. Sentry shows the gap as untracked time.
- **Errors charged to core.** A bad plugin that crashes something in core arrives as `core`. Keep
  those. They're core's to harden against.

When official plugins move to their own repository ([split](../split.md)), "official" becomes
"installed from the acorn organization's releases", which the installer already records in its lock
file. Package signing ([plugin signing](../plugin-signing.md)) is the stronger check and replaces that
when it ships.

## Acceptance

- With a folder install shadowing `linear` and throwing on load, nothing owned by `linear` reaches
  the team's project.
- The same plugin's errors reach a Settings connection or `ACORN_SENTRY_DSN`.
