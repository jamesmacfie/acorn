# Omarchy survey: how its plugins work, mapped onto acorn

Part of [docs/future/client-plugins/](./README.md). Read on 2026-08-29 from the [develop
guide](https://omarchyplugins.com/develop.html), the [publish
guide](https://omarchyplugins.com/publish.html), the shell README at `basecamp/omarchy` (branch
`quattro`, `shell/README.md`), the first-party plugin README (`shell/plugins/README.md`), and the
`menu` and `bar` manifests. Omarchy moves quickly; treat the paths and field names as a snapshot.

## How an Omarchy plugin is built

A plugin is a folder, `~/.config/omarchy/plugins/<id>/`, holding `manifest.json` and one QML file
per kind it declares. The manifest's required fields are `schemaVersion`, `id` (reverse-DNS, and
`omarchy.*` is reserved), `name`, `version`, `author`, `license`, `description`, `kinds`, and
`entryPoints`. A `bar-widget` also carries `displayName`, `category`, `allowMultiple`,
`defaultSection`, defaults, and a settings schema. `keepLoaded: true` mounts a panel at startup
instead of on demand.

The six kinds, from the shell README:

| Kind | What it is | Loaded |
| --- | --- | --- |
| `bar-widget` | A component the active bar drops into a section | with the bar |
| `panel` | A persistent or summoned floating window, such as the OSD | on demand unless `keepLoaded` |
| `overlay` | A fullscreen surface, such as the wallpaper picker | on demand |
| `menu` | A summoned menu surface | on demand |
| `service` | A headless singleton | at startup |
| `bar` | A full bar that replaces `omarchy.bar` | one at a time |

Plugins share the `omarchy-shell` process. The develop page says it plainly: "They run unsandboxed
with your user permissions." Validation is `omarchy plugin validate` (manifest parses, kinds match
entry points, files exist at safe relative paths, no `omarchy.*` id, no symlinks) plus `qmllint`.

## How it is installed and controlled

- `omarchy plugin add <git url> --enable`, `omarchy plugin remove <id>`. Third-party plugins land
  disabled pending the user's own review. Updates show a diff before applying.
- `omarchy plugin clone omarchy.clock --edit` copies a built-in into the user folder under a new id.
  The shell prefers the clone, and "existing shortcuts and shell IPC calls made to the built-in id
  are routed to the enabled clone."
- `omarchy-shell shell summon|hide|toggle <id> <payloadJson>` and `call <id> <method> <arg>` drive a
  plugin from any script or compositor keybind. Plugins expose `open(payloadJson)`, `close()`, and
  whatever else they like.
- Saving a file under `~/.config/omarchy/plugins/` reloads plugin code.
- `~/.config/omarchy/shell.json` holds the bar layout (`left`, `center`, `right` sections), inline
  per-widget settings, `bar.id` for the active bar, and `disabledPlugins[]`. "No `config:`
  sub-object, no separate per-plugin settings file, no merge layers."
- The menu is data: `default/omarchy/omarchy-menu.jsonc` plus the user's
  `~/.config/omarchy/extensions/omarchy-menu.jsonc`, merged at startup and watched. Entries carry
  `when:` and `checked:` bash expressions and an `action:` string the shell runs with
  `Quickshell.execDetached`.
- The marketplace is a GitHub issue form and a human approving a listing. The publish page says it
  "validates listings, not plugin security."

Shared services and theming for plugins are, in the README's words, "explicitly out of scope here
and deferred to a follow-up." A plugin reads a `Style` singleton and an `appLibrary` the shell
injects; there is no plugin-facing theme contract.

## The mapping onto acorn

| Omarchy | acorn today | Verdict |
| --- | --- | --- |
| `bar-widget` in a section | `topbar.right` slot (`registries/slots.ts`), `task.footer`, rail markers as data (`registries/railMarkers.ts`), `nodeStats` | Covered. acorn has no user-arranged sections in chrome; `pane.aside` is the user-arranged region and it holds dashboard panels, not chrome. Left alone. |
| `panel` | panes (`registries/panes.ts`), `refPanels`, frames with `target: 'overlay'` for loaded plugins | Covered. |
| `overlay` | the `overlay` slot for compiled plugins; refused to loaded plugins because "a contribution there would paint over the very prompts asking whether to trust it" | Covered, and the refusal stands. |
| `menu` | commands, `paletteRows`, `contextMenus`, keybindings | Covered. acorn's menu entries name command ids, not shell strings. |
| `service` | a plugin's node half; a client plugin's `activate()` | Covered. |
| `bar` replacement | `CORE_EXCLUSIVE_SLOTS = ['rail.taskList']`, one surface | **Gap.** [04-replaceable-surfaces.md](./04-replaceable-surfaces.md). |
| plugin folder on the machine | a package on a node's disk, served to devices | **Gap.** [03-device-provenance.md](./03-device-provenance.md). |
| clone a built-in, shell prefers the clone | offer to replace, user picks, core returns on failure | acorn's is better. Registering seizes nothing. |
| `shell.json` | Settings UI over `localStorage` (`persistence/devicePrefs.ts`); no client config file | **Gap, deferred.** [06-user-config.md](./06-user-config.md). |
| `when:` / `action:` bash in menu config | none, and none wanted | Refused. [refused.md](./refused.md). |
| starts disabled, updates show a diff | per-device `(plugin, hash)` consent, a diff over stable grant keys, three tiers never merged | acorn's is better. |
| hot reload on save | dev grant per `(plugin, node)` auto-accepts new hashes; `POST /v2/core/plugins/:id/reload` for the node half | Covered for node plugins. A device plugin needs the same dev grant keyed on the device; phase 0 does that. |
| `summon` from outside the shell | none | Small gap. A command id is the right unit; a CLI or URL that runs one is a later single-file design, not part of this folder. |
| theming for plugins | `contributions.themes` as validated token data, generated CSS, namespaced ids | acorn's exists and Omarchy's does not. Style packs are the remaining axis; [05-appearance-and-icons.md](./05-appearance-and-icons.md). |
| icons | `brand:` marks as one SVG `d` in a 24-box; Lucide by name; no replacement | Parked. The door is in 05. |
| `allowMultiple` | none | Not wanted. acorn's chrome slots are contribute-once; dashboards already allow several panels of one collection. |
| `keepLoaded` | compiled plugins always; loaded surfaces mount when shown | Not needed. A device plugin that needs to run at boot has `activate()`. |

## What to take

Three ideas, none of which is the unsandboxed part:

1. The user installs a plugin on the device and it is that device's business. Phase 0.
2. A built-in surface is one provider of a named slot, and a plugin may offer another. Phases 1 and
   2.
3. The user's picks and layout are data a person can read. Phase 4, and only as data.

## What to leave

In-process code, bash in config, review-by-the-user as the security story, symlink installs. Each is
argued in [refused.md](./refused.md). Also left: `allowMultiple` and user-arranged chrome sections.
acorn's answer to "arrange your own widgets" is the dashboard region, and a second arrangement
system in the topbar would be a second dashboards.
