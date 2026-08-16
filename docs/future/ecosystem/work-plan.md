# The sequenced work

From the ecosystem-feasibility session (2026-08-14), pruned 2026-08-16, and pruned again the same day
when phase 1 shipped — the phase numbers below are the original ones and do not renumber, because
several docs cite them.
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

## What is actually waiting on something (2026-08-16)

The phases below say what depends on what. This says what is *blocked*, which is a different and much
shorter list: **nothing here waits on another team or an external dependency, with one exception.**
For everything else "when" is a capacity question, not a sequencing one — so the answer to "when can
we start phase N" is almost always "now, and the real question is what else stops".

Startable today, in any order:

- **Phase 2's first sub-step** — process supervision and lifecycle, reusing the reload path's
  candidate-then-commit shape. Nothing gates it, it is independently useful, and it is the critical
  path for anything discovery-shaped.
- **Phase 3's remaining backlog** — the typed-collection contract, the panel grid and cross-source
  mapping all shipped (owning doc: `docs/dashboards.md`). What is left is the deliverables in
  `docs/future/dashboards/` — new placements, dynamic collections, board-drag write-back —
  each independent of phase 2, each with its own verify-before-building list.
- **The signing design doc** — it does not exist, and writing it is not gated on phase 2.
- **`bundle.md` steps 2–4** — the Linux node-pty prebuild in CI, the CI matrix and release upload for
  Linux and Windows, then the Windows `openssl` problem. Do that last one before anyone downloads a
  Windows build: `ensureCert` shells out to `openssl`, stock Windows has none, and it fails at first
  boot with the node refusing to start.

Gated, and it is the only item on the list: **discovery** — hard on phase 2, and it has a recorded
stance without a design.

**The one thing effort cannot route around.** macOS is stuck in two separate places on a single
purchase. A downloaded node tarball containing `.node` binaries is quarantined by Gatekeeper
(`bundle.md § Two snags`), and the desktop app still ships unsigned with no auto-update. Both clear
with one Apple Developer Program membership plus notarization, and notarization needs setup time
before it works. Worth buying before it is on the critical path, because it is the only item here that
waiting does not shrink.

**Two different signing problems, easy to confuse.** Phase 4 says "signing" twice and means different
things each time. Item 1 is **plugin-package attestation** (sigstore-style, gate 2 in `blockers.md`) —
that is what the standing refusal on plugin auto-update hangs off. The macOS signing inside item 2 is
**Apple Developer ID code signing and notarization**, which is about distributing the app and the node
tarball. Neither substitutes for the other, and they unblock different things.

## Phase 1 — the front door — **shipped 2026-08-16**

Kept as a numbered stub because other docs cite it. The scaffold is `npm create acorn-plugin`
(`packages/create-acorn-plugin`) and the publishable half of the facade is `acorn-plugin-sdk`
(`packages/plugin-sdk`), with the compatibility promise in `docs/plugins.md § What is published`.
The last item — the folder install — landed the same day: `allowLocalPath` is gone and `{ path }` is a
first-class source on every build, so the directory the scaffold writes installs on a packaged acorn.
It was decided as a trust-boundary question rather than a config flag, and the reasoning is
`docs/security.md § Installing from a folder` — including the one thing it must not claim, that a
symlinked folder is not hash-pinned and never will be.

Phases 2–4 do not renumber.

## Phase 2 — rung-2 containment (owning doc: `docs/security.md § The containment ladder`)

One child process per plugin node half, plugin-scoped token, fs jail, ctx-as-RPC. The six design
rules that keep this a refactor are already enforced; the work is still the long pole of the whole
program. Sub-steps worth staging: process supervision and lifecycle first (the reload path's
candidate-then-commit semantics are the shape to reuse), then the RPC ctx, then the fs/network
jail. Dev-mode plugins inherit the containment when it lands, which retroactively strengthens the
dev trust grant.

Deliverable: "declared" becomes "enforced" for plugin node halves; the permission UI's language
can finally strengthen.

## Phase 3 — dashboards (owning doc: `docs/dashboards.md`)

**Shipped (2026-08-16)**: the typed-collection contract proven on GitHub + Linear, Home as a
composable panel grid, mapping/derived views/kanban — the user-composed todo board across two
providers works end to end. It is the most visible form of "plugins composing without knowing each
other".

What remains is the backlog in `docs/future/dashboards/` (new placements, dynamic
collections, board-drag write-back), independent of phases 1–2 here.

## Phase 4 — distribution (owning docs: `docs/security.md § Supply chain`, `docs/future/bundle.md`)

In order:

1. **Signing** — plugin-package attestation, needs a design doc first (sigstore-style is the named
   direction). Unlocks the standing refusal on *plugin* auto-update. Not the same thing as the macOS
   signing in item 2 — see the note above.
2. **The node install story** — the unfinished half of `bundle.md`, in its own order: Linux node-pty
   prebuilds, the CI release matrix, Windows `openssl`, then macOS. A remote node becomes a download
   instead of a tarball ritual. The first three are startable today; macOS is the one item behind the
   Apple Developer Program purchase, which the app's own auto-update is also behind.
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
this file: whether rung 2 shipped out of order; whether ecosystem-last is still the recorded stance
in `docs/extensibility.md`; and whether a folder install still refuses to pin (if something started
recording entrypoint digests for `{ path }`, the honesty argument in
`docs/security.md § Installing from a folder` has quietly changed).
