# Phase 4: the device config file

Status: not started. Waits on a terminal host with a config directory (`docs/future/terminal/phase-3-process-and-auth.md`).

## Goal

One file per device, data only, holding the device prefs a person would edit and the list of
device-held plugins. Read at boot and on change, written when Settings changes a covered pref, never
executed. The terminal host reads the same file format from its own path.

## Why this phase, and why now

It waits because until there is a terminal host, every user has Settings open and the file is a
second surface for one audience. When the `acorn` command from `docs/future/terminal/phase-3-process-and-auth.md` exists, its first
user will want this on day one. Doing it then, rather than now, means the file's first reader is the
person it is for.

## Scope

In:

- `acorn.json` at `<userDataDir>/acorn.json` on desktop; the terminal host's config path there.
- The covered keys, from [06-user-config.md](./06-user-config.md): `theme`, `themeLight`,
  `themeDark`, `themeFollowSystem`, `style`, `keybindings`, `railOrder`, `leftCollapsed`,
  `exclusiveSlots`, `plugins`.
- The helper watches the file; the renderer applies a change as it applies a Settings change.
- Settings writes the file when a covered pref changes, so the two never disagree.
- A parse error keeps the last good state and raises a notice with the line and column.
- Unknown keys are preserved on write and ignored on read.
- `plugins` entries name a source; the client offers to install each one not yet installed, through
  the normal install path and the normal prompt. The file never grants.
- A JSON schema for the file, generated from the Zod shape and committed beside the plugin schema,
  so an editor can validate it.

Out: node prefs, plugin state, tokens, endpoints, anything executable, and any merge layering. One
file, one device.

## Design detail

**One store, two doors.** The file is a projection of `DEVICE_KEYS` entries plus the device-plugin
list. On read, each covered key is written to `devicePrefs` through the existing setter, which is
what makes the change live. On a Settings write, the file is regenerated from the store. The helper
owns the file so the renderer never touches disk, following the rule that the renderer holds no
files.

**Write order.** `docs/state-ownership.md` and the memory of the device-pref write-order bug both say:
`localStorage` before the query cache, or the new value is discarded. A file read goes through the
same setter and inherits the order.

**Schema.** `deviceConfigSchema` in `@acorn/protocol`, a `z.object` with every key optional and
`.passthrough()` for unknown keys. `keybindings` reuses the override map type. `exclusiveSlots`
reuses the picks type. `plugins` is `{ id, source }[]` with the four-form source union.

**The terminal host.** Reads the same schema from its own path (`$XDG_CONFIG_HOME/acorn/acorn.json`
or the host's choice), through its own `PluginCustody` for the `plugins` list. Nothing in this phase
is terminal-specific except the path.

## Code touched

- `packages/protocol/src/deviceConfig.ts` (new): the schema.
- `packages/desktop-helper/src/config/deviceConfig.ts` (new): read, watch, write.
- `apps/desktop/src/shell/{wire.ts,bridge.ts}` and `apps/desktop/src/helper/helperServer.ts`:
  `config-read`, `config-write`, `config-changed`.
- `packages/client-core/src/infra/platform/{index.ts,contract.ts}`: a `config` group, nullable, so a host
  without a file (the PWA) has none and Settings hides the "Open config file" row.
- `packages/client-core/src/infra/persistence/deviceConfig.ts` (new): apply a read; regenerate on write.
- `packages/client-core/src/features/settings/`: "Open config file" and the parse-error notice.
- `packages/plugin-types/` or a sibling: the generated JSON schema.

## Tests

- `deviceConfig.test.ts` (helper): a saved file with a bad line keeps the last good state and
  reports the line; unknown keys survive a round trip.
- `persistence/deviceConfig.test.ts`: applying a read writes `localStorage` before the cache; a
  Settings change regenerates the file with the same unknown keys.
- A `plugins` entry for an uninstalled id produces a pending install offer and no cache entry until
  accepted.
- `contract.test.ts`: a host with a half-built `config` group fails `seamProblems()`.
- The schema round-trips the fixture file.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 4 rows: `docs/state-ownership.md § Device`, `docs/shell.md
§ Files on disk`.

## Doors left open

Against [07-hosts.md](./07-hosts.md): item 7, no node pref in the file and no key executed, held by
the schema having no string field that is ever passed to a shell or `import()`. The `config` group
is nullable so the PWA is not a half-built host.

## Done when

- Editing `style` in the file changes the running desktop app; changing it in Settings changes the
  file.
- A `plugins` entry produces a trust prompt and nothing else.
- The terminal host reads the same file and applies `theme` and `keybindings`.
- `pnpm lint`, `pnpm test`, and the desktop boot test are green.

## Verify before building

- A terminal host exists that reads config from a path. If not, this phase is not yet due.
- `packages/client-core/src/infra/persistence/devicePrefs.ts` has the setter every covered key goes
  through, and the write-order rule holds in it.
- `packages/desktop-helper/src/broker/fleetStore.ts` shows how the helper owns a `0600` file; copy its
  shape for `acorn.json` (which is not secret and needs no `0600`, but the read and write pattern is
  the same).
- `packages/client-core/src/infra/platform/contract.ts` lists groups as `members<T>()([...])`; add
  `config` the same way.
- Phase 0 of this folder has shipped, so `plugins` entries have an install path to call.
