# Refused: what was considered and set aside, with the argument

Part of [docs/future/client-plugins/](./README.md). Each of these will be asked for again, and the
request will sound reasonable. This file exists so the argument is had once.

## Plugin code in the shell process

Omarchy's model: a plugin is QML loaded into the running shell, with the user's permissions. It is
why an Omarchy plugin can do anything, and it is refused here for the same reason
`docs/future/ecosystem/blockers.md` refuses disclosure-only node code as "bb's trade": once the code
is in the process, the install prompt is the security model, and a prompt cannot describe what
arbitrary code will do. acorn's client containment is the iframe today and the worker after layout
phase 3, and a device-held plugin uses the same one. "It is on my own machine" does not change the
argument, because the shell holds a loopback socket to the helper that holds every device token.

## A trusted-local tier

The softer version: a plugin the user installed locally could be trusted more, run in the shell's
bundle, and reach `window.acorn`. Refused because it is the previous item with a nicer name. The
platform seam exists so that exactly one folder reaches `window.acorn`
(`tools/arch/boundaries.test.ts`), and a tier that lets plugin code past it would make the seam a
suggestion.

## A node half on a device

A device-held plugin might want a route, a schedule, or a tool, run on the device. Refused. The
device has no node process, and inventing one would create a second place that runs plugin code with
disclosure-only permissions, doubling the surface `docs/security.md` is honest about. A plugin that
needs node code is a node plugin and installs on a node. A plugin that is client-only can be
device-held. The line is the manifest's `node` entry, and the helper refuses a package that has one.

## Bash strings in config

Omarchy's menu entries carry `when:`, `checked:`, and `action:` shell expressions the shell
evaluates. Refused for the device config file and for every descriptor. acorn's unit of "do
something" is a command id, and a keybinding, a menu row, or a config entry names one. A shell
string in a file is code execution behind a text editor, and the whole of `docs/security.md`'s
config-trust work (hash-gated `.acorn/config.toml`, the `ConfigTrustDialog`) exists because the repo
already had to close that door once.

## Review-by-the-user as the security story

Omarchy installs third-party plugins disabled so the user can read the code before enabling. Refused
as a substitute for containment. It is fine as a habit and useless as a model: nobody reads 4,000
lines of QML, and an update replaces them. acorn keeps its per-hash consent and its containment and
adds nothing here.

## Symlinked folder installs as a first-class path

A `{ path }` install on the device is supported, pins nothing, and says so, as it does on a node.
Making it the default developer path, or hiding the fact that it pins nothing, is refused.
`docs/plugins.md` already records that a folder install is outside the supply-chain story.

## Replacing the command palette

Refused for this programme. A palette drives the shell's focus stack (`PaletteSurface` is on
`/ui/host` for that reason) and the layout programme's `refused.md § A second keymap` forbids plugin
key handling outside inputs and rectangles. The palette's rows are already contributable through
`paletteRows`, which is the extension point a palette needs. If a real case appears for a different
palette body, it can be argued then against a concrete plugin, after layout phase 4 shows what the
remote root can and cannot do with focus.

## Replacing the overlay stack

Refused, unchanged from `docs/plugins.md`: a contribution there would paint over the trust prompt.

## A generic "replace anything" slot

The request will be: instead of naming `pane.switcher`, `rail`, and `topbar`, let a plugin replace
any component by id. Refused. Each surface needs a contract, and a contract is what lets the
replacement be drawn by a worker, projected to a terminal, and described in one trust sentence. A
generic mechanism would have no contract and therefore none of those. `CORE_EXCLUSIVE_SLOTS` grows
by named entries, each with a phase.

## `allowMultiple` and user-arranged chrome sections

Omarchy lets a bar widget appear twice and lets the user arrange sections in `shell.json`. Refused
for acorn's chrome. The dashboard region (`pane.aside`, the home dashboard) is acorn's user-arranged
surface, and a second arrangement system in the topbar would be a second dashboards with a smaller
grid. A plugin that wants a user-placeable thing contributes a collection.

## Cross-device sync of a device plugin's state

A device plugin's `plugin:<id>:*` prefs live on the device, and a user with two machines configures
it twice. Refused to sync them through a node, because the node is not the owner of a plugin it does
not have, and refused to sync them through the relay in `docs/future/remote.md`, because that relay
is designed as a dumb pipe and should stay one. If the config file in phase 4 is checked into
dotfiles, that is the sync.

## Auto-update for device plugins

Same answer as node plugins, from `docs/future/ecosystem/blockers.md` gate 2: no auto-update until
signing exists. Every hash change re-prompts, by design. A device install does not change what is
being trusted.
