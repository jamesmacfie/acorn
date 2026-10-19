# Open every rail source from the palette

Date: October 19, 2026. Status: implemented October 19, 2026, except the check on a second Node
without Docker. Baseline: `bf0e4ee8c`.

This product requirements document covers palette rows and optional shortcuts for the desktop
left rail's source icons. It is for implementers of client-core's palette and keybinding hosts.

## Problem and outcome

The left rail's icons open sources: Home, Fleet, Archive, and one per plugin source such as Git,
Docker, Agents, Memory, Workflows, GitHub, GitLab, and Bitbucket. Only some of them can be opened
from the command palette, and only one has a shortcut.

At the baseline, a source has a palette row in one of two ways:

- Its plugin registers its own `source.<id>.open` command. Docker, Agents, GitHub, GitLab, and
  Bitbucket do this.
- The person hides it from the rail, and the palette host generates `core.rail.open.<id>`
  (`packages/client-core/src/host/palette/sourceOpeners.ts`, filtered by `hiddenSourcesToOpen` in
  `packages/client-core/src/features/tabs/railVisibility.ts`).

Home, Fleet, Archive, Git, Memory, and Workflows get no row while the rail draws them. GitHub alone
has a default shortcut, `⌘0` (`plugins/github/src/client/index.ts`). The Shortcuts settings page
lists only registered bindings, so a person cannot give any other source a key.

The required outcomes are:

- Every source the rail can draw has an **Open <label>** palette row, whether the rail draws it or not.
- Every one of those rows has a shortcut that is unbound by default and that the person can set in
  **Settings → Shortcuts**.
- No source has a default chord. GitHub's `⌘0` goes away.
- The set of rows and shortcuts follows the sources available on the active Node, so a plugin the
  Node lacks offers nothing.

## Scope

The work changes the desktop palette host, five plugins' client entrypoints, and the terminal
client's palette registration. It doesn't change the rail's drawing, ordering, or visibility
switches, and it doesn't reserve a chord range for sources. `⌘1` to `⌘9` stay with the task list.

## One generated opener per source

Make the host's generated opener the only opener for a source.

1. Drop the hidden-only filter. The generator registers a row for every entry that
   `availableSources` returns, core sources included. Keep the rail click's opening rule: the same
   `sourceOpeningPath` call and the same error for a project-scoped source with no project open.
2. Change the generated command id to `source.<id>.open`, the id the five plugins use. A person
   who rebound GitHub's shortcut keeps their key, because overrides are keyed by binding id.
3. Keep the **hidden from the left rail** hint, but only on rows for sources the rail isn't drawing.
4. Delete the plugin-owned commands: `source.docker.open` in `plugins/docker/src/client/commands.ts`,
   `source.agents.open` in `plugins/agents/src/client/commands.ts`, and the `ctx.commands` and
   `ctx.keybindings` registrations in the GitHub, GitLab, and Bitbucket client entrypoints. With
   one owner, the stand-aside rule in `hiddenSourcesToOpen` and `pluginOpenerId` has nothing left to
   do. Remove both.

Docker's and Agents' rows lose their hint text and extra search words, such as "containers". The
generated row searches on the label, plus `rail` and `source`. That loss is accepted. If it needs
fixing later, add optional palette text to the source contribution rather than bringing back
plugin-owned openers.

## Unbound shortcuts

Register one keybinding per generated row, beside the row and disposed with it:

| Field | Value |
| --- | --- |
| `id` and `command` | `source.<id>.open` |
| `description` | `Open <label>` |
| `category` | `Rail` |
| `defaultChord` | `''` |
| `when` | `global` |

`resolveKeybindings` already treats an empty default as unbound, and the Shortcuts page already
shows **Unbound** with a way to record a chord. Confirm both with a test rather than assuming them.

Overrides live in the device's `keybindings` preference
(`packages/client-core/src/infra/persistence/devicePrefs.ts`), not per Node. Keep it that way. A key
set for Docker works on every Node that has Docker, and it sits unused on a Node that doesn't. The
Shortcuts page already reports overrides for removed plugins. Check that a source missing only from
the active Node isn't reported as removed.

The registration runs inside `CommandPalette`. Confirm that the component mounts for the window's
life, not only while the palette is open. If it doesn't, move the generator to a host component
that does, or a shortcut would only work after the palette had been opened once.

## The terminal client

The terminal client's palette reads the same command registry
(`apps/tui/src/chrome/paletteSession.ts`). At the baseline it shows the five plugin-owned rows and
none of the generated ones. Deleting the plugin commands would drop **Open Docker** and the rest
from it.

Register the generated rows in the terminal client too, from shared code that doesn't depend on
the desktop router. The terminal has no hidden-from-rail switch, so it shows no hint. Shortcuts in
the terminal follow its own keymap (`apps/tui/src/chrome/bindings.ts`) and are out of scope. Opening
a source must go through the terminal's own source routing (`apps/tui/src/chrome/routing.ts`).

## Tests, fixtures, and docs to update

- `packages/client-core/src/features/tabs/railVisibility.test.ts`: the `hiddenSourcesToOpen` cases go
  with the function. Add a case for the generator listing drawn and hidden sources, with the hint
  only on hidden ones.
- `plugins/docker/src/client/commands.test.ts` and `plugins/agents/src/client/commands.test.ts`:
  remove the opener expectations.
- `apps/desktop/test/client/clientPluginDisable.snapshot.json`: the `source.*.open` ids move from
  the plugins to the host. Regenerate it, and check that disabling a plugin still removes its row,
  now because its source leaves `availableSources`.
- `docs/github-integration/palette.md`: Open GitHub has no chord, and the host owns it.
- `docs/command-palette-and-shortcuts.md`: describe the generated rows and the **Rail** group.
- `docs/plugins/descriptors.md`, `docs/plugin-authoring/settings-pages.md`,
  `docs/testing/settings.md`, and `docs/testing/rail-and-annotations.md`: the **Open <label>** row
  no longer depends on hiding the source.

## Verify and hand off

Run `pnpm lint`, the client-core, desktop, terminal, and five plugin suites, and
`pnpm --filter @acorn/arch-tests test`.

Use the [isolated desktop driver](../local-development/agent-drivers.md) to check these:

1. The palette lists **Open <label>** for every rail icon, with the hint only on a hidden one.
2. Binding a key to Docker in **Settings → Shortcuts** opens Docker from anywhere in the window.
3. On a Node without Docker, neither the row nor the binding appears. Switching back restores both.
4. `⌘0` does nothing until the person binds it.
5. Opening Memory, a project-scoped source, with no project open shows the rail's own message.

In the terminal client, check that **Open Docker** and the other rows are in its palette and open
the source.
