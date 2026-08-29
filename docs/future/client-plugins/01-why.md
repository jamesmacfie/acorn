# Why: the argument, condensed

Part of [docs/future/client-plugins/](./README.md). This is the reasoning from the 2026-08-29
conversation that produced the folder, kept short enough to read before the design files.

## The question

Omarchy's plugins can change the whole shell: a widget in the bar, a new bar, an overlay, a menu, a
headless service. A user clones a built-in, edits it, and the shell prefers the clone. acorn is more
restricted on purpose. The owner asked what acorn can learn, and named one gap: only nodes hold
plugins, so a person who wants a different task switcher or a different look has nowhere to put that
plugin except a node, where it is the wrong shape and reaches the wrong audience.

## Where Omarchy's flexibility comes from

Two places, and it matters which is which.

The first is the thing acorn refuses. Omarchy plugins are QML loaded into the one long-running
`omarchy-shell` process, unsandboxed, with the user's permissions. The develop page says so, and the
publish page says the marketplace "validates listings, not plugin security". A plugin can do
anything the shell can because it is the shell. `docs/future/ecosystem/blockers.md` already refuses
this trade for node code, calling it "bb's trade", and the argument is the same for shell code.

The second is a set of decisions that have nothing to do with sandboxing:

- The shell exposes named slots, and a plugin manifest names which slots it fills.
- A user can pick a replacement for a built-in by id, and the built-in returns if the replacement
  goes away.
- The user's layout and per-widget settings live in one file the user can edit.
- Third-party code starts disabled and updates show a diff.

Every one of those is a design choice acorn could make while keeping its containment. Most of them
acorn has already made, in stronger form. See [02-omarchy-survey.md](./02-omarchy-survey.md) for the
kind-by-kind mapping.

## What acorn already has

The survey surprised us. acorn's plugin model covers Omarchy's six kinds with named slots, a closed
descriptor vocabulary for chrome, frames for rectangles, and one replaceable core surface
(`rail.taskList`) whose arbitration is better than Omarchy's: registering seizes nothing, the user
picks in Settings, and core returns whenever the provider is absent, disabled, untrusted, or throws.
Colour themes are contributable as validated data, which Omarchy does not have at all. The trust
prompt diffs over stable grant keys, which is Omarchy's "updates show a diff" done properly.

So the gap is not power. It is two stances.

## The two stances

**Nodes hold plugins.** This falls out of the fleet model: a device may be looking at a node it has
never seen, whose plugins it does not have, and the app artifact must never ship third-party code.
So the node hands the device code to run, the device hashes it, and consent binds to the hash. That
is the right design for a plugin that has a node half. It is the wrong owner for a plugin that only
changes how this device draws things. Installing a pane switcher on a node offers it to every device
paired with that node, stores its state on the node, and makes it disappear when the user looks at a
different node.

The fix is smaller than it sounds. The desktop helper already owns everything a device-held plugin
needs: a content-addressed bundle cache, a per-device trust store keyed on `(pluginId, hash)`, dev
grants, and the `PluginCustody` seam the renderer talks through. Bundles arrive in that cache from
nodes today. Give the helper a second way to fill it, from GitHub, npm, a tarball, or a folder, with
no node in the picture, and mark the record's provenance. The trust prompt, the hash check, and the
render path do not change. [03-device-provenance.md](./03-device-provenance.md) has the design.

**Core chrome is core's.** `frontend.md` already says the shell imports no feature UI. The rail, the
topbar, the pane switcher, and the palette are hard-coded JSX in `App.tsx`, `TabRail.tsx`, and
`TaskPaneHost.tsx` that consume registries but are not themselves in one. `rail.taskList` is the one
exception, and it shows the shape: core draws its own task list as one provider of a slot, a plugin
may offer another, the user chooses. Extending that to the switcher, the rail, and the topbar is one
named slot and one written contract per surface.
[04-replaceable-surfaces.md](./04-replaceable-surfaces.md) has the contracts.

## Why this waits for the layout programme

A loaded plugin draws in a sandboxed iframe today. An iframe cannot drive the shell's focus
machinery, which is why `PaletteSurface` is on `/ui/host` and not `/ui`. A replacement pane switcher
has to take part in F6 region focus, the intent keymap, and host-owned collection state, or it is a
worse switcher than the one it replaces. Layout phase 3 gives loaded plugins a render path that can:
a worker producing a tree of kit nodes the host mounts, with focus and keys coming from the kit.
Layout phase 4 gives the `replace` arbitration and the trust copy for it.

Starting the surfaces before phase 3 would mean building a switcher contract for iframes that phase
3 deletes. Starting device provenance before phase 3 is fine, because provenance is about where
bytes come from, not how they draw. That is why phase 0 of this folder is the only phase with no
dependency on layout.

## Why the kit makes the three hosts cheap here

The owner asked that desktop, mobile, and terminal stay in view. For replaceable surfaces this is
nearly free, and the reason is the closed kit. A replacement switcher is a tree of kit nodes. Every
kit node has a `NODE_SUPPORT` row with a `tui` column and an 80×24 sentence. Every layout has a
narrow and a terminal projection. A plugin that replaces the switcher inherits all of that without
knowing it, because it cannot name a pixel. The one thing that is not free is custody: each host
needs its own bundle cache and trust store behind the `PluginCustody` interface.
[07-hosts.md](./07-hosts.md) says what each owes.

## What we are not taking from Omarchy

In-process unsandboxed plugin code. Bash strings in config files. "Starts disabled so you can review
it" as a security model. Symlinked folder installs as a first-class path. The argument for each is
in [refused.md](./refused.md).
