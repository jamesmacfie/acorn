# Refused: what was considered and set aside, with the argument

Part of [docs/future/structure-followup/](./README.md). Each of these will be asked for again, and
the request will sound reasonable. This file exists so the argument is had once.

## Designing the cloud control plane here

The review that produced this folder listed four decisions a cloud would need: how a client reaches a
node on a short-lived machine, whether such a node has a durable data root, how a baked image arrives
with plugins, and how a provider declares its create form. The owner decided on 2026-08-30 not to
design any of it yet. What this folder keeps is the README's "Keeping the cloud door open" section:
four facts that are true today and must stay true. A design is written when there is a business
behind it, against the seams as they are then.

## A plugin-supplied transport or dialer in the custody package

If cloud nodes sit behind a NAT, the obvious ask is a seam where a provider plugin says how to reach
its endpoint. Refused because the dial happens in the credential path: the custody package holds the
device token and the certificate pin, and a plugin that shapes the connection is a plugin in that
path. `docs/security.md` § The control plane keeps plugins out of it everywhere else. A provider
returns a URL the host can dial. How the URL became dialable is the provider's networking, and
[remote.md](../remote.md) owns the relay question if it is ever ours.

## Removing the terminal host-capability probe

`hasHostCapability({ plugin: 'terminal' })` names a plugin from core, which phase 1 is otherwise
removing. Refused because "does this host have that plugin" is the host's own question, answered from
the roster the node reported, and the probe is the seam that lets a compiled plugin's absence degrade
cleanly. Phase 1 moves the decisions that use the probe into the plugin that owns them and leaves the
probe.

## Renaming `apps/desktop/src/helper/` with the package

Once the package is `@acorn/custody`, the desktop's `helper/` folder looks like the odd one out.
Refused because it is the desktop's process, the one Rust spawns and supervises, and "helper" is what
a host calls a process it owns. The terminal host will have its own word for the same role. The
package is host-neutral; the process is not.

## Promoting `ACORN_BUNDLED_PLUGINS_DIR` to a documented production input

A headless image that arrives with plugins would set this variable, so it is tempting to document it
as the supported way. Refused because that is the first line of the cloud design the owner deferred.
The README names the variable so nobody removes it; `docs/node-distribution.md` § Plugins keeps
calling it a developer path until a deployable needs otherwise.

## A per-row reason column for the compiled-only contribution kinds

The review's fourth finding was that `docs/contribution-kinds.md` and `docs/first-party-plugins.md`
list compiled-only kinds without saying, per row, why each has not become a descriptor. Checked on
2026-08-30 and found already done: every single-tier row in `docs/contribution-kinds.md` carries a
**Direction** cell naming whether it stays compiled or gains a manifest twin and why, and
`tools/arch/contributionKinds.test.ts` fails a single-tier row without one. Refused as a phase because
the work exists. Phase 3's re-read of the table is the only residue.

## Renaming `@acorn/desktop-helper`, and the overturn

The 2026-08-30 folder reorganisation refused this. The name says who spawns the package, not what it
does; "broker" or "custody" would be truer. It refused on release-path cost: the name appears in the
bundle staging scripts, the Tauri sidecar config, `docs/shell.md`, and
`docs/architecture-overview.md`, and the architecture doc already defines the package in one
sentence. A rename buys a better word at the cost of a release-path change.

Overturned by the owner on 2026-08-30, and [phase-0-custody-rename.md](./phase-0-custody-rename.md)
is the result. The argument that overturned it is new rather than louder: three programmes compose
this box from three hosts, so the better word is worth more than it was when one host composed it.
Both halves stay here so a later session argues with the reasoning rather than with silence.

## Folding this into the parent programme

Four more phases on the folder reorganisation would have kept one folder. Refused because that
programme promised that nothing in it changes behaviour, and phases 1 and 2 here change what code
does: a source declares its default pane, a loaded plugin's type
loses members, verbs are renamed under a major bump. Keeping the promise is worth a second folder.
