# User config: a device config file, as data, later

Part of [docs/future/client-plugins/](./README.md). Phase 4 builds it, and phase 4 waits for a
terminal host to exist.

## Why a file at all

acorn has no client config file. Appearance, shortcuts, rail order, collapse state, and the
exclusive-slot picks are Settings UI over `localStorage` (`persistence/devicePrefs.ts`), and
everything else is a node pref. That is the right default for a desktop app: the UI is the
documentation, and there is no file to get wrong.

Two things change the answer. A terminal user expects a file; every terminal tool they use has one,
and a Settings modal in a TUI is a worse editor than the one they already have open. And a person
who installs three device plugins and picks two replacement surfaces has made a configuration they
may want to read, copy to another machine, or check in beside their dotfiles. Omarchy's `shell.json`
is the example that made the case.

## What the file is

One file per device, `<userDataDir>/acorn.json` on desktop and the terminal host's own config path
there, holding the device prefs in `DEVICE_KEYS` that a person would plausibly edit:

- `theme`, `themeLight`, `themeDark`, `themeFollowSystem`, `style`
- `keybindings` (the override map by binding id)
- `railOrder`, `leftCollapsed`
- `exclusiveSlots` (the pick per slot, by provider id)
- `plugins` (the device-held plugin list: id and source, so a file names what to install)

Everything in it is already a device pref or a device-plugin record. The file is a second door onto
the same state, not a second state. The client reads it at boot and on change, writes it when
Settings changes a covered pref, and the two never disagree because they are one store with two
surfaces.

## What the file may never hold

- A shell string, a script, a path to run, or anything executed. Omarchy's `action:` and `when:` are
  the part of its design acorn refuses, and the argument is in [refused.md](./refused.md). A
  keybinding names a command id. A pick names a provider id.
- A node pref. Task layouts, open files, filters, and dashboards belong to the node the resource is
  on (`docs/state.md`), and a device file that held them would make the device the owner of state it
  does not own.
- A token, a certificate, a fingerprint, or a node endpoint. `fleet.json` and the keychain own those
  and they are not configuration.
- Plugin state. `plugin:<id>:*` prefs are the plugin's, written through its `state` verb, and a user
  editing them by hand is a support case.
- Anything that would need a trust prompt. A file that names a plugin to install still goes through
  the install path and the prompt. The file is a request, not a grant.

## Reload

On desktop the helper watches the file and the renderer applies changes as it applies a Settings
change, so a saved file is a live change. A parse error keeps the last good state and raises a
notice with the line. An unknown key is kept and ignored, so a file written by a newer build reads
on an older one.

## Why it waits

Until there is a terminal host, every user of this file has Settings open in front of them, and the
file is a second way to do something the UI already does well. Building it earlier would mean
maintaining two surfaces for one audience. When `docs/future/terminal.md`'s toy host exists, its
first user will want this on day one, and that is the day to build it.
