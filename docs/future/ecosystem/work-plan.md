# The sequenced work

Design notes from the ecosystem-feasibility session (2026-08-14). Nothing here is scheduled. This
is the ordering and the dependency argument; the designs themselves live in the owning folders and
are not repeated here. A developer or agent picking up any phase should read the owning doc first
and treat this file as the map.

The ordering principle: ship the loop for *your own* plugins first (cheap, no new attack surface,
proves the seams), fix the front door for authors in parallel (additive, independently useful),
and put containment before discovery so acorn never has a window where strangers can find plugins
whose node halves run uncontained. Distribution goes last because everything before it makes
distribution worth having.

Cross-cutting preconditions from the node-first review (`docs/future/node-first/`): the
client↔node version contract (`version-skew.md`) had to land **before phase 5 releases anything**,
because the freedom to break the wire ends at the first standalone download — it shipped on
2026-08-15 and the contract is now `docs/api-reference.md § Versioning`; the platform-seam
ratchet and the state-ownership rule are cheap and should land before the phases that build on
them (web-facing work and dashboards respectively).

## Phase 1 — the dev loop (owning doc: `docs/future/user-extensions/`)

The five items of `user-extensions/README.md § Recommended build order`, which front-loads the
pieces with no security surface:

1. The no-bundler authoring profile (a documented contract, no code).
2. The reload path — node-side candidate-then-commit re-init, the "plugins changed" event,
   client re-resolve + re-sync. The biggest lift of this phase.
3. Approval-mediated install — the agent's install request rides the existing high-risk
   agent-tool permission flow; the device performs the install.
4. The dev trust grant — per-(pluginId, device) while dev mode lasts, replacing per-hash prompts.
5. Agent enablement — the authoring skill, generated API types from the running node, the seeded
   "Create a plugin" prompt.

**Also in this phase, small and user-facing:** generalize the local-path install
(`allowLocalPath`, today dev-build-only) into "point acorn at a folder of plugins" as a
first-class install source, riding the same trust flow. It is the folder half of the end goal and
it is a small delta on shipped machinery.

Deliverable: a user or their agent iterates on a plugin against a live node with one approval per
plugin, and "my plugins live in this folder" works.

## Phase 2 — developer experience (owning docs: `docs/plugins.md`, `docs/testing.md`; mostly done)

The eight review findings shipped in August 2026, in roughly their suggested order: failure
visibility first, then boilerplate, the dev loop, the testkit, the loadability tests, then plugin
storage, the golden lists and the facade prune. `docs/plugins.md`, `docs/testing.md`,
`docs/data-layer.md` and `docs/local-development.md` are where that behavior is written down; the
residue those eight left behind is listed in `dx.md § Verify before building`.

What remains of this phase is the one thing the review did not cover because it is packaging rather
than a finding: **make `@acorn/plugin-api` installable from outside the workspace** (see `dx.md`).
Scaffolding and authoring guides stay deliberately last per `docs/extensibility.md`.

Deliverable: an external author can `npm install` the facade and build against the documented
profile. The other half — failures that name themselves, and testing without rebuilding the host —
is already true inside the workspace.

## Phase 3 — rung-2 containment (owning doc: `docs/security.md § The containment ladder`)

One child process per plugin node half, plugin-scoped token, fs jail, ctx-as-RPC. The six design
rules that keep this a refactor are already enforced; the work is still the long pole of the whole
program. Sub-steps worth staging: process supervision and lifecycle first (reusing the phase-1
reload semantics), then the RPC ctx, then the fs/network jail.

Interaction to respect: if rung 2 lands before phase 1's dev trust grant is heavily used, dev mode
inherits its containment — `agent-authored-plugins.md § 4` names this ordering as desirable.

Deliverable: "declared" becomes "enforced" for plugin node halves; the permission UI's language
can finally strengthen.

## Phase 4 — dashboards (owning doc: `docs/future/dashboards/`)

Phases 1–3 of that folder's build order: the typed-collection contract proven on GitHub + Linear,
Home as a composable panel grid, then mapping/derived views/kanban. Independent of phases 1–3
here; can start any time. It is the most visible form of "plugins composing without knowing each
other."

Deliverable: the user-composed todo board across two providers — the folder's own motivating
scenario.

## Phase 5 — distribution (owning docs: `docs/security.md § Supply chain`, `docs/future/bundle.md`)

In order:

1. **Signing** — needs a design doc first (sigstore-style attestation is the named direction).
   Unlocks the standing refusal on auto-update.
2. **The node install story** — the unfinished half of `bundle.md`: Linux node-pty prebuilds, the
   CI release matrix, Windows `openssl`, macOS signing. A remote node becomes a download instead
   of a tarball ritual. (The app's own Developer-ID/notarization question is the same knot.)
3. **Discovery** — an unreviewed listing over signed packages, honest about being unreviewed,
   riding the shipped per-(plugin, hash) trust and permission-diff consent. Hard-gated on phase 3;
   do not ship discovery over uncontained node halves.

Deliverable: a stranger finds a plugin, installs it from the listing onto a desktop or remote
node, and the trust story told in the prompt is true.

## What is deliberately absent

- Widening the frame sandbox (cap, workers, network) — the recorded answer is host-owned surfaces.
- A `when` expression language, plugin-supplied regexes, uncooperative extension — all refused in
  the owning docs; those refusals stand.
- Auto-update before signing; review-implying marketplace curation; downgrade support.

## Verify before building

Each owning doc carries its own verify-before-building list — use those. Cross-cutting checks for
this file: whether rung 2 shipped out of order (re-derive the phase 3/phase 1 interaction);
whether `allowLocalPath` is still dev-gated (phase 1's folder-install item assumes it); whether
ecosystem-last is still the recorded stance in `docs/extensibility.md`; and whether phase 2 has
shrunk to the packaging item alone, or the facade has been published and phase 2 is closed.
