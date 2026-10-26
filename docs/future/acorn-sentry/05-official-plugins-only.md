# Phase 5: only official plugins

Date: October 26, 2026, from the October 17, 2026 plan. Status: not started. Depends on
[phase 4](./04-ship-the-dsn-in-release-builds.md).

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
