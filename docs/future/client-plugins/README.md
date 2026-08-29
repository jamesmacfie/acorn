# Client plugins: plugins a device holds, and core surfaces a plugin may replace

Status: proposal, 2026-08-29. Nothing here has started.

This folder is the plan for two changes to how acorn is extended. Today every plugin lives on a
node, and that node serves the plugin's client bundle to each paired device. After this programme a
plugin can also live on a device, with no node half, installed and trusted by that device alone.
Today one core surface, the task list in the rail, can be replaced by a plugin the user picks. After
this programme the pane switcher, the rail, and the topbar can be, each behind a written contract
and the same user arbitration.

Together those two changes give acorn what Omarchy gives its users: a different task switcher, a
different bar, a different look, installed by the person sitting at the machine and nobody else.
They do it without Omarchy's trade, which is unsandboxed code in the shell process.

Everything acorn does today keeps working. The security rules in `docs/security.md` are not loosened
anywhere in this folder: a device-held plugin has no node half, so nothing new runs with the node's
access, and its client half runs in the same iframe or worker as a node-held one. The programme
builds desktop first and carries the PWA and the terminal host in every phase's "doors left open"
section, as the layout programme does.

Two things are parked, not refused. Icon sets are the first: the door is held open in
[05-appearance-and-icons.md](./05-appearance-and-icons.md) and no phase builds them. A device config
file is the second: it is designed in [06-user-config.md](./06-user-config.md) and scheduled last,
after a terminal host exists to want it.

## Where this came from

The owner read the [Omarchy plugin development guide](https://omarchyplugins.com/develop.html) and
asked what acorn can learn from a system whose stated goal is that plugins can change the whole
shell. [02-omarchy-survey.md](./02-omarchy-survey.md) is the record of that reading, mapped onto
acorn kind by kind. [01-why.md](./01-why.md) is the argument that came out of it.

Where this folder and an owning doc under `docs/` disagree after a phase ships, the owning doc wins.
Where this folder and [layout/](../layout/README.md) disagree, layout wins: this programme leans on
its remote root and its `replace` arbitration and must not redesign either.

## The goals, in the order they appeared

1. **A plugin can belong to a device.** Someone who wants a different pane switcher installs it on
   the machine they are sitting at. It is not a node's business, it does not follow them to other
   devices unless they install it there too, and it never runs on a node.
2. **Core surfaces are replaceable by offer.** The mechanism that lets a plugin offer to draw the
   rail's task list extends to the pane switcher, then the rail, then the topbar. Registering seizes
   nothing; the user picks; core returns whenever the provider is absent, disabled, untrusted, or
   throws.
3. **Appearance is data all the way down.** Colour themes are contributable today as validated token
   maps. Style packs join them, with a value alphabet of their own. Icon sets are the third axis and
   are parked.
4. **Three hosts, one custody contract.** The desktop helper, the PWA's browser, and the terminal
   host each hold their own bundle cache and trust store behind the same interface, so "installed on
   this device" means the same thing on each.
5. **A config file, later.** A person at a terminal expects to edit a file. The file is data only,
   names commands by id and never by shell string, and waits until there is a terminal host.

## Decisions taken

These were decided with the owner and are settled. A phase file may not reopen them.

| Decision | Why | What it forecloses |
| --- | --- | --- |
| A device-held plugin has **no node half**. A package with a `node` entry is refused at device install. | The node/shell boundary is where acorn's containment stops (`docs/security.md`). Adding a second place that runs node code would double the disclosure-only surface. | Device plugins cannot add routes, schedules, tools, or storage. They are client-only by construction. |
| A device-held plugin renders through the **same paths** as a node-held one: a sandboxed iframe today, the remote root worker after layout phase 3. Nothing is added to the shell's own bundle. | The trust decision covers bytes the device hashed. A third render path would be a third thing to contain. | No "trusted local plugin" tier that runs in the shell. Omarchy's model is refused, on the record, in [refused.md](./refused.md). |
| **Nothing here starts before layout phase 4 ships**, except phase 0 of this folder, which needs no layout work. | A replacement switcher has to drive focus, intents, and collection state. Only the remote root can, and only phase 4 has the `replace` arbitration and the trust copy for it. | This folder waits. Phase 0 is the one thing that can land early. |
| Replaceable surfaces are added **one at a time, each with a written contract**. | A slot opened is hard to close (`registries/slots.ts`). The contract is the cost; the mechanism is cheap. | No generic "replace anything" API. `CORE_EXCLUSIVE_SLOTS` grows by named entries. |
| A device plugin's state is **device-scoped**. | Its `plugin:<id>:*` prefs have no node to live on, and following the active node would make a device plugin's settings change when the user switches nodes. | No cross-device sync of a device plugin's state. Install it twice, configure it twice. |
| Icon sets are **parked**. | The owner's call, 2026-08-29. The shape is written down so the door stays open. | Nothing. No phase builds it. |

## The admission rule for a replaceable surface

A core surface joins `CORE_EXCLUSIVE_SLOTS` only if all four hold:

1. Its replacement can be drawn from the closed kit. If drawing it needs a pixel, a class, or a key
   event, it is a rectangle, and rectangles do not replace chrome.
2. Its contract fits in one type: what the provider receives, what it may call back, and nothing
   about how core draws it. If the contract needs a shell callback that a worker cannot receive, the
   surface stays core's.
3. A person reading the trust prompt sentence for it would knowingly accept it. "Draws the pane
   switcher" is a sentence. "Draws the shell" is not.
4. Core's own drawing of it goes through the same registry, so the fallback and the replacement are
   two providers of one slot, not a special case and a normal case.

[refused.md](./refused.md) holds what failed the rule and why.

## The files

Supporting documents, readable in any order:

| File | What it holds |
| --- | --- |
| [01-why.md](./01-why.md) | The argument, condensed. Read this first if you were not in the room. |
| [02-omarchy-survey.md](./02-omarchy-survey.md) | How Omarchy plugins work, mapped onto what acorn has, what to take, and what to leave. |
| [03-device-provenance.md](./03-device-provenance.md) | The device-held bundle: custody, install, resolution against the fleet, trust, state, uninstall. |
| [04-replaceable-surfaces.md](./04-replaceable-surfaces.md) | The surfaces that become exclusive slots, the contract for each, arbitration, and fallback. |
| [05-appearance-and-icons.md](./05-appearance-and-icons.md) | Style packs as data, the value alphabet, and the parked icon-set door. |
| [06-user-config.md](./06-user-config.md) | The device config file: what it may hold, what it may never hold, and why it waits. |
| [07-hosts.md](./07-hosts.md) | What the desktop helper, the PWA, and the terminal host each owe the custody contract. |
| [refused.md](./refused.md) | What was considered and refused, with the argument. |
| [docs-migration.md](./docs-migration.md) | Every document under `docs/` that changes, which phase changes it, and how. |

## The phases

| Phase | File | What it delivers | What it unblocks | Waits on |
| --- | --- | --- | --- | --- |
| 0 | [phase-0-device-held-bundles.md](./phase-0-device-held-bundles.md) | A plugin installed on a device by its helper; provenance on every bundle record; device-scoped state; a device section in Settings → Plugins | Every device plugin. A client-only plugin with panes, sources, commands, and themes works from here | Nothing |
| 1 | [phase-1-pane-switcher.md](./phase-1-pane-switcher.md) | `pane.switcher` as the second exclusive slot, with its contract; core's switcher as the first provider | The concrete thing the owner asked for | Layout phase 4 |
| 2 | [phase-2-rail-and-topbar.md](./phase-2-rail-and-topbar.md) | `rail` and `topbar` as exclusive slots, each with a contract that hands the provider data and verbs, never markup | The Omarchy "full bar" move | Phase 1 |
| 3 | [phase-3-style-packs.md](./phase-3-style-packs.md) | `contributions.styles` as validated data with a length, number, and font alphabet | Shape and density from a plugin | Phase 0 |
| 4 | [phase-4-device-config.md](./phase-4-device-config.md) | A device config file that names commands and picks by id and is never executed | A terminal user's expectation | A terminal host exists |

## The order of work

Phase 0 stands alone. It touches the helper, the platform seam's `plugins` group, `resolveBundles`,
the trust store, and Settings, and none of that is layout work. It is worth landing early because it
is the half of the ask that changes a stance rather than a surface, and because every later phase
here installs its test plugins through it.

Phases 1 and 2 are strictly ordered and both wait for layout phase 4. The pane switcher goes first
because it is the smallest surface with a real contract, it is the example the owner gave, and
`rail.taskList` already proves the arbitration on its neighbour. The rail and topbar follow because
their contracts are larger and because a replaced rail needs the switcher contract to exist for the
right-hand side.

Phase 3 waits only on phase 0, because the first style pack worth testing arrives as a device
plugin. Phase 4 waits on a terminal host, which is outside this folder.

## How to work a phase

Each phase file has the same sections as the layout programme's: goal, why now, scope, design
detail, code touched, tests, docs owed, doors left open, done when, verify before building. The same
two rules apply:

- **Verify before building.** File and line references were checked against the tree on 2026-08-29.
  Paths rot. Run the verify list at the end of each phase file before writing code.
- **Update the owning doc in the same change.** [docs-migration.md](./docs-migration.md) says which
  document owns each behaviour afterwards. A phase is not done until that document says the new true
  thing.

## What this folder is not

- It does not build the remote root, the worker, or the `replace` arbitration. Those are layout
  phases 3 and 4 and this folder consumes them.
- It does not build the PWA or the terminal host. [07-hosts.md](./07-hosts.md) says what each owes
  the custody contract; `docs/future/remote.md` and `docs/future/terminal.md` own the hosts.
- It does not change signing, discovery, or the marketplace stance. `docs/future/ecosystem/` owns
  those, and a device install from a URL is exactly as unsigned as a node install from one.
- It does not build icon sets. It keeps the name.
- It does not schedule anything.
