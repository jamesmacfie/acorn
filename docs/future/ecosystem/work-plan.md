# The sequenced work

From the ecosystem-feasibility session (2026-08-14), pruned 2026-08-16 to what is still ahead.
Nothing here is scheduled. This is the ordering and the dependency argument; the designs live in
the owning docs and are not repeated here. A developer or agent picking up any phase should read
the owning doc first and treat this file as the map.

Already shipped and removed from this plan: the agent-authored dev loop (authoring contract,
reload, approval-mediated install, dev trust grant, agent enablement — `docs/plugin-authoring.md`,
`docs/plugins.md`), plugin themes and the new chrome/extension vocabulary, and the node-first
preconditions (the client↔node version contract in `docs/api-reference.md § Versioning`, the
platform seam, node-side compositions in `docs/state.md`).

The ordering principle for what remains: fix the front door for authors first (additive,
independently useful), put containment before discovery so acorn never has a window where
strangers can find plugins whose node halves run uncontained, and keep distribution last because
everything before it makes distribution worth having.

## Phase 1 — the folder install (owned here)

Most of this phase shipped. The scaffold is `npm create acorn-plugin`
(`packages/create-acorn-plugin`); the publishable half of the facade is `acorn-plugin-sdk`
(`packages/plugin-sdk`), unscoped so it needed no npm organisation, with the compatibility promise
written down in `docs/plugins.md § What is published`. The seven entrypoints that were *not*
published never will be, and that section says why. `dx.md`, which owned this phase, is gone with it.

What is left is the one thing that actually strands a stranger today, and it was never packaging.
Generalize the local-path source (`allowLocalPath`, today dev-build-only) into "point acorn at a
folder of plugins" as a first-class install source, riding the same trust flow. A **packaged** acorn
refuses the directory the scaffold just wrote, so the authoring guide's last step fails on every
build an external author actually has.

It is small and user-facing, and blocked on nothing — but read it as a **trust-boundary** change,
not a config flag. `allowLocalPath` is dev-build-only on purpose, and widening it means deciding
what a symlinked, in-place-editable, unsandboxed node half is allowed to be on a released build
(`docs/security.md`). Start there, not in the installer.

Deliverable: an external author with no checkout of this repo can scaffold, follow
`docs/plugin-authoring.md`, and install from a folder on a released build.

## Phase 2 — rung-2 containment (owning doc: `docs/security.md § The containment ladder`)

One child process per plugin node half, plugin-scoped token, fs jail, ctx-as-RPC. The six design
rules that keep this a refactor are already enforced; the work is still the long pole of the whole
program. Sub-steps worth staging: process supervision and lifecycle first (the reload path's
candidate-then-commit semantics are the shape to reuse), then the RPC ctx, then the fs/network
jail. Dev-mode plugins inherit the containment when it lands, which retroactively strengthens the
dev trust grant.

Deliverable: "declared" becomes "enforced" for plugin node halves; the permission UI's language
can finally strengthen.

## Phase 3 — dashboards (owning doc: `docs/future/dashboards/`)

Phases 1–3 of that folder's build order: the typed-collection contract proven on GitHub + Linear,
Home as a composable panel grid, then mapping/derived views/kanban. Independent of phases 1–2
here; can start any time. It is the most visible form of "plugins composing without knowing each
other".

Deliverable: the user-composed todo board across two providers — the folder's own motivating
scenario.

## Phase 4 — distribution (owning docs: `docs/security.md § Supply chain`, `docs/future/bundle.md`)

In order:

1. **Signing** — needs a design doc first (sigstore-style attestation is the named direction).
   Unlocks the standing refusal on auto-update.
2. **The node install story** — the unfinished half of `bundle.md`: Linux node-pty prebuilds, the
   CI release matrix, Windows `openssl`, macOS signing. A remote node becomes a download instead
   of a tarball ritual. (The app's own Developer-ID/notarization question is the same knot.)
3. **Discovery** — an unreviewed listing over signed packages, honest about being unreviewed,
   riding the shipped per-(plugin, hash) trust and permission-diff consent. Hard-gated on phase 2;
   do not ship discovery over uncontained node halves.

Deliverable: a stranger finds a plugin, installs it from the listing onto a desktop or remote
node, and the trust story told in the prompt is true.

## Threaded through, not a phase

`docs/future/compiled-tier.md` — which compiled plugin moves next, what blocks it, what gets
deleted when it goes. Consult it whenever a move is proposed; moves stay opportunistic
(`docs/extensibility.md § Unexercised seams rot`).

## What is deliberately absent

- Widening the frame sandbox (cap, workers, network) — the recorded answer is host-owned surfaces.
- A `when` expression language, plugin-supplied regexes, uncooperative extension — all refused in
  the owning docs; those refusals stand.
- Auto-update before signing; review-implying marketplace curation; downgrade support.

## Verify before building

Each owning doc carries its own verify-before-building list — use those. Cross-cutting checks for
this file: whether rung 2 shipped out of order; whether `allowLocalPath` is still dev-gated
(phase 1's folder-install item assumes it); whether ecosystem-last is still the recorded stance in
`docs/extensibility.md`; and whether the facade has been published (phase 1 closed).
