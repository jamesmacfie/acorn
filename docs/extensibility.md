# Extensibility

This page is the reasoning behind the plugin system: what it's for, why it has two tiers, and which
of its constraints are deliberate. Read it before you widen a seam, because several decisions look
like gaps until you know what they protect. The [plugin reference](./plugins.md) describes how the
system works.

Two topic pages hold the rest of the reasoning:

- [UI and cooperation](./extensibility/ui-and-cooperation.md): descriptors, trees, and rectangles,
  plugins extending each other, and the closed kit.
- [The node half and bundled plugins](./extensibility/runtime.md): the worker realm and the plugins
  acorn ships as loaded packages.

The plan for what comes next is in [where the plugin system is going](./future/ecosystem/where-this-is-going.md).

<a id="data-code-and-pixels"></a>
<a id="plugins-may-extend-each-other-and-only-by-invitation"></a>
<a id="plugins-get-building-blocks-not-just-a-boundary"></a>
<a id="the-node-half-is-isolated"></a>
<a id="bundled-plugins-shipped-but-loaded"></a>
<a id="where-this-is-going"></a>

## The goal

Anyone should be able to extend acorn without forking it, and installing something from a stranger
shouldn't need an expert's judgment. Those two halves pull against each other. A system that can be
extended arbitrarily makes every install a leap of faith, and a perfectly safe system usually can't be
extended enough to be worth it. Most decisions below are where the two were balanced.

## Why loadable JavaScript, and not external processes

The common alternative is a language-agnostic executable driving a CLI: a plugin is any program,
called with arguments, calling back through a command line. acorn rejected it:

- It abandons the trust model. acorn gives child processes task-scoped tokens and never provider
  credentials, and an arbitrary executable sits outside all of that.
- It duplicates the contribution system as a second-class CLI surface.
- It can't take part in the renderer, so every plugin with a UI would be impossible.

The architecture already suited loadable JavaScript: plugin-owned wire contracts, per-plugin SQLite
files and migration chains, the per-Node disabled set, and registration disposal in both hosts. The
loader was the missing piece.

## Two tiers, permanently

Compiled plugins are built into the binary and run in the shell's own realm. Loaded plugins are
installed at runtime and run sandboxed. This isn't a transition, and the loaded tier won't grow until
it can do everything the compiled one can.

The line is whether the contribution can be expressed as data plus asynchronous messages. If it can,
it can be sandboxed. Panes, reference panels, settings pages, importers, overlay pickers, rail
sources, badges, palette rows, attention items, Node stats, content links, commands, keybindings,
typed record sets, webviews, and managed-agent harnesses all turned out to fit.

Harnesses show the line running inside one feature. An agent that speaks the Agent Client Protocol is
a launch spec and a stream of messages, so it's data and it sandboxes. Codex's app server carries fork,
compaction, archive, and delete, which ACP can't express, so it stays a native driver
([harnesses](./managed-agents/harnesses.md)).

If a contribution can't be expressed that way, it needs the shared realm and stays first-party. The
list is short: owning a WebSocket stream or channel, a component the shell renders inside its own tree
at a place it hasn't opened as an extension point, code that runs in the desktop shell, and something
core can't start without. Before adding to it, ask whether the owner could open a point instead.
Usually it can.

"Another plugin renders it" isn't the same as "embedded in a render tree". A reference panel looks
like the first and is the second: a rectangle the host places, so it sandboxes. GitHub used to render
Linear's panel beside a pull request. It calls `openRefPanel({ providerId, displayId })` instead, the
shell draws the panel, and Linear ships it as a sandboxed tree.

When a third-party plugin needs something on the first-party list, the answer is review and adoption
into first-party, not a wider sandbox. Convenience is never a reason to widen it.

## First-party is a reason, not a status

Being in the binary isn't a privilege, and "it's ours" isn't an argument. Every plugin that stays
first-party should name which reason applies to it, and [first-party
plugins](./first-party-plugins.md) is that audit. The answers change, so check them again from time to
time. GitHub turned out to need almost nothing: it stopped being required, its content links became
declarative, and one capability with a consumer is what keeps it in the binary. Rollbar needed nothing
and moved out.

## The Node distributes, and the device decides

A plugin is installed on a Node, and that Node serves its client bundle to every device that pairs
with it. A client may look at a Node whose plugins it doesn't have, and the app must never ship
third-party code. So a Node hands a device code to run, which inverts the usual trust direction:

- **Trust binds to bytes the device hashed itself**, never to what a Node claims. A compromised Node
  can lie in its listing but not about what it sent.
- **Consent is per device and per bundle.** Pairing a new machine asks again, and an update asks
  again with what changed.
- **Nothing a Node pushes runs automatically.** A rejected or undecided bundle registers nothing.

[Third-party plugin bundles](./security/plugin-bundles.md) owns the threat model.

## The host binds every namespace

Anything a plugin supplies that names something is a claim, not an authority. Route prefixes,
contribution ids, provider ids, command ids, keybinding ids, capability ids, task origins, and task
link connections are all bound or checked by the host from the manifest it read, never from a value
in plugin code or a route response.

acorn got this wrong three times: a permission list rendered from manifest text under a heading that
said "enforced", a task origin taken from a route body, and a facet handing over every provider's
mappings and trusting the caller to filter. None was dramatically exploitable, and all three were the
same mistake. If you're adding a plugin surface, assume it's the mistake you're about to make.

## Unexercised seams rot

Every significant gap in this system was found because no production plugin used that path. A
review found three real defects in exactly the places nothing exercised. The loaded route seam
shipped with no caller, and when a plugin finally used it, it turned out to be bypassable.

So prove seams with plugins that have to keep working, not with fixtures. A fixture passes because it
was written against the seam, and a real plugin fails when the seam is wrong. The corollary is a
constraint: don't migrate a plugin for tidiness. Move one when it exercises something nothing else
does, or when it needs its own release cadence.

## Some decisions that look like gaps

Each of these has been questioned, and each answer is deliberate:

- **The shell stays SolidJS.** A plugin draws a frame in any framework or a tree of host components,
  so the host's framework is private. What would reopen this is letting third-party components render
  inside host surfaces, which is the tier line.
- **A frame can't claim the escape keys.** Escape, the palette, settings, and task switching can't be
  captured, so the person can always get out.
- **Plugins can't bind unmodified keys.** Bare keys belong to text entry.
- **Existing keybindings win.** A plugin never displaces a binding that already works, and the loser
  is unbound and labeled. The person outranks all of it.
- **No `when` expression language, key sequences, or automatic fallback chords.** Each is a small
  feature that becomes a permanent surface.
- **Discovery, if it ever exists, will be unreviewed.** Trust is enforced on the person's devices at
  install and load time, not by vetting a listing, so acorn offers no browse-and-discover list. A
  listing would imply a review acorn can't promise.

## Related

- [Contribution kinds](./contribution-kinds.md): every kind, its tier, and its direction.
- [Security](./security.md): trust boundaries and the containment ladder.
- [The terminal client](./tui.md): a second host for the same component tree.
- [The editor](./editor.md): the host-owned document surface.
