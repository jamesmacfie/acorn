# Phase 0: the custody rename

Status: not started. Waits on [structure/](../structure/README.md) phase 7.

## Goal

The package that holds fleet membership, device tokens, certificate pins, plugin trust, and node
supervision is called what it is. `packages/desktop-helper` becomes `packages/custody` and
`@acorn/desktop-helper` becomes `@acorn/custody`. The desktop keeps `apps/desktop/src/helper/`,
because that folder is the desktop's process, the one Rust supervises, and "helper" is the right word
for a process one host spawns. The package it composes is not the desktop's.

## Why this phase, and why now

[structure/refused.md](../structure/refused.md) refused this rename on 2026-08-30 because the name
appears in the bundle staging scripts, the Tauri sidecar config, and two docs, and the architecture
doc already defines the package in one sentence. That was weighed against a better word. The argument
here is different: three programmes compose this box. [terminal/](../terminal/README.md) phase 3
builds "one node, three supervisors" on it, [remote.md](../remote.md) calls its web shape a
`WebBroker`, and [client-plugins/](../client-plugins/README.md) names its contract `PluginCustody`.
Each of those will cite the package by name, and each citation of `desktop-helper` from a terminal or
web host is a sentence a reader has to un-read. The owner overturned the refusal on 2026-08-30 on
that basis; [structure/refused.md](../structure/refused.md) records the overturn so the argument
stays in one place.

It goes first because the two unstarted programmes cite the package and have not been rewritten yet
(structure phase 7 rewrites them against the moved tree). One rename before that sweep is cheaper
than one after.

## Scope

### The package

`git mv packages/desktop-helper packages/custody`. `name` in its `package.json` becomes
`@acorn/custody`. No folder inside it moves; structure phase 3 already flattened it to `index.ts` plus
`broker/`, `custody/`, `plugins/`, `supervision/`. The inner `custody/` folder stays, because the
package is the whole custody stack and that folder is the token store specifically. If that reads as
a stutter in practice, rename the inner folder `tokens/` in the same commit and say so here.

### The specifier

Every `@acorn/desktop-helper/...` import becomes `@acorn/custody/...`. On 2026-08-30 the importers
were `apps/desktop/src/helper/helperMain.ts`, `apps/desktop/src/helper/helperServer.ts`,
`apps/desktop/src/helper/helperServer.test.ts`, and the dependency line in `apps/desktop/package.json`.
Two client-core comments name the trust store by package
(`packages/client-core/src/host/plugins/distribution.ts`,
`packages/client-core/src/host/trust/trustModel.ts`) and one Rust doc comment names a path that no
longer exists (`apps/desktop/src-tauri/src/lib.rs`, the `legacyCustody.ts` line); fix all three.
`pnpm install` rewrites the lockfile.

### The arch test

`tools/arch/boundaries.test.ts` names the package in four places: the process-broker exception list
(`serviceHost.ts`), the wildcard-exports note, `PLUGIN_STORE_OK`, and the assertion that the trust
store's owner is in the offender set. Update the strings. The rule titles that say "main" ("Only main
touches the third-party plugin cache and trust store") say "custody" afterwards; `main` is the word
structure retired.

### The shell

Check `apps/desktop/src-tauri/tauri.conf.json`, the bundle staging scripts under
`apps/desktop/scripts/`, and `apps/desktop/vite.helper.config.ts` (or whatever builds the helper
entry) for the package name. The refusal said these carry it; on 2026-08-30 a source grep found only
the `package.json` dependency and the Rust comment, so the release path may already be clear. Verify
before assuming either way.

### Docs

The topology diagram in `docs/architecture-overview.md` § Runtime topology says
`desktop helper (Node): connection broker, fleet, tokens, plugin custody, supervision`. It becomes two
lines: the desktop's helper process, and the `@acorn/custody` package it runs. § Package boundaries,
the paragraph beginning "The custody stack stays shell-free", names the package. `docs/shell.md`,
`docs/testing.md`, and `docs/plugins.md` name it where they describe the helper. The terminal and
client-plugins programmes' path hints change in place. [docs-migration.md](./docs-migration.md) lists
every row.

## Out of scope

- Renaming `apps/desktop/src/helper/`, `helperMain.ts`, or `helperServer.ts`. See
  [refused.md](./refused.md).
- Closing the package's `./*` exports map. Still the bigger job `docs/architecture-overview.md`
  records.
- Any change to what the package does.

## Done when

- `rg 'desktop-helper' --glob '!docs/future/structure/**' --glob '!docs/future/structure-followup/**'`
  returns nothing in source, config, or docs. The two structure folders keep their historical rows.
- `pnpm lint` and `pnpm test` are green, and `pnpm --filter @acorn/desktop test` is green, because the
  boot test stages the helper bundle and would be the first thing a broken sidecar path breaks.
- `docs/architecture-overview.md` § Runtime topology draws the process and the package as two things.

## Verify before building

- `packages/desktop-helper/` is still the name, and its `src/` still has the four flat groups.
- The four `@acorn/desktop-helper` import sites above are still the only ones.
- The bundle staging scripts and the Tauri config do or do not name the package; the refusal said they
  did, the 2026-08-30 grep said they did not.
- [structure/refused.md](../structure/refused.md) still carries the refusal and its overturn line.
