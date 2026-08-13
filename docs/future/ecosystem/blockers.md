# The four gates, and what answers each

Design notes from the ecosystem-feasibility session (2026-08-14). Nothing here is scheduled. Each
gate below is a deliberate decision with recorded rationale — not a gap someone forgot — which
means each is reversed by a decision plus its designed answer, not by rearchitecture. Ordered by
how hard they gate the end goal.

## 1. The node half is disclosed, not contained

**What.** A loaded plugin's node bundle runs in-process inside the Node. `permissions.node` shapes
the `ctx` the host hands it — undeclared facets are absent, `secrets`/`exec` default off — but the
bundle shares the process and can `import('node:fs')`, open `core.sqlite`, or monkeypatch globals.
`docs/security.md § Node-half plugin security` says this plainly, and every permission UI is
required to say *declared*, never *enforced*.

**Why it gates everything marketplace-shaped.** For plugins the user authored (the
user-extensions dev loop), disclosure is the accepted deal — the human entered dev mode for that
plugin on that device. For a stranger's plugin found through discovery, disclosure-only means the
install prompt *is* the security model. That is bb's trade, and
`docs/future/user-extensions/README.md` refuses it on the record. Shipping discovery before
containment converts an honest, documented weakness into a liability.

**The designed answer.** `docs/security.md § The containment ladder`, rung 2: one child process
per plugin, a plugin-scoped token, a `--permission` fs jail, `ctx` becomes RPC. Rung 3 adds OS
sandboxing for network egress. Six design rules already enforced today were chosen specifically so
rung 2 stays a refactor: fetch-shaped route handlers, async-only ctx, structured-clone-safe
capabilities, no general secret read path, and friends. This is the single biggest lift in the
whole program and the hard precondition for gate 2's discovery half.

## 2. No signing, no discovery

**What.** Installs are hash-pinned (the phase-5 lockfile records source, resolved version, archive
sha256, entrypoint hashes) and audited, but packages are not signed and provenance is a
recommendation. `docs/security.md § Supply chain` names sigstore-style signing as future work.
There is no marketplace, and `docs/extensibility.md` is deliberate about what one could be:
unreviewed, because "anything that implies review by listing would be a promise we cannot keep."

**Why it gates.** Two standing refusals hang off this: no auto-update until signing exists (every
hash change re-prompts, by design), and no discovery surface at all. "Install from GitHub" works
today — the installer speaks GitHub release, npm, and https — but "find a plugin you didn't
already know about" does not, and safely cannot yet.

**The designed answer.** Partial. Signing has a named direction (sigstore-style attestation) but
no design doc. Discovery has a stance (unreviewed, honest about it) but no design. The
update-consent flow it would ride — per-(plugin, hash) device trust with a permission diff on
update — is shipped. Work plan: design signing first, then discovery as a listing over signed
packages, and only after rung 2.

## 3. Nothing reloads

**What.** Every install/update/uninstall returns `installed-restart-required`; contribution sync
runs at boot and on trust decisions only; `activeBundles` is resolved once per session. A remote
node needs an operator to restart it. Inventoried in
`docs/future/user-extensions/current-state.md § The change model`.

**Why it gates.** It makes the dev loop restart-shaped (a prompt and two restarts per iteration),
and it makes plugin management on a *remote* node genuinely painful — "restart the node" is not a
button when the node is on another machine.

**The designed answer.** `docs/future/user-extensions/agent-authored-plugins.md § 2`: one new
"plugins changed" event from the node; the client re-resolves bundles and re-runs the two syncs
that already exist; node-side candidate-then-commit re-init built on the host's shipped
`clearRegistrations()`/`contain()` seams; the ESM cache defeated with a generation query
parameter. Client-side, acorn is better placed than bb: plugin UI is an iframe keyed by bundle
hash on a content-addressed scheme, so a swap is loading a different URL — nothing leaks. Scope
stays dev-mode plugins; store installs keep restart-required semantics deliberately.

## 4. External authors cannot build a plugin

**What.** `@acorn/plugin-api` (six entrypoints, snapshot-pinned surface) is a workspace
dependency. `docs/extensibility.md § Plugins get building blocks` records that it is "not yet
resolvable for a genuinely external" plugin — an accepted intermediate state. Around it sit the
eight developer-experience findings of `docs/future/debug-plugin/`: failures that misreport or say
nothing, no watch mode, four trust prompts per dev boot, tests that rebuild the host by hand, ~90
lines of copied boilerplate per loaded plugin.

**Why it gates.** Until the facade installs from npm and failures name themselves, third-party DX
is not a polish question — the front door is closed. No amount of marketplace work matters before
this.

**The designed answer.** Fully designed: each debug-plugin file carries a plan, with
`01-failure-visibility.md` first for reach. Publishing the facade is packaging work with one
design decision attached (what version/compat contract to promise — the `PLUGIN_API_MAJOR` gate
already exists). Details and the authoring-experience bar in `dx.md`.

## What is deliberately not on this list

- **The 8 MiB frame cap and no-workers CSP.** Monaco proved some surfaces cannot live in a frame;
  the recorded answer is host-owned surfaces plugins borrow (`docs/future/monaco.md`), not a wider
  sandbox. That is a boundary, not a blocker — see `shell-vision.md`.
- **The closed action-verb set and descriptor vocabulary.** Rollbar's rail losing its filters was
  found honestly and answered with "move exploration into the frame." Growing the verb set is a
  per-verb decision, not a program.
- **Plugin-to-plugin interop.** Capabilities, content links, ref resolvers, and the designed
  cooperative extension points (`docs/future/user-extensions/extension-points.md § 3`) cover it
  host-mediated. bb-style uncooperative extension is refused on the record and stays refused.

## Verify before building

Whether rung 2 has shipped (changes gates 1 and 3's risk text); whether the lockfile still pins
hashes and the installer still refuses downgrades; whether `activeBundles` is still
session-pinned and contribution sync still boot-only; whether `@acorn/plugin-api` became
publishable in the meantime; and whether the debug-plugin findings list has shrunk.
