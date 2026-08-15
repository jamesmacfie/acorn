# The gates, and what answers each

From the ecosystem-feasibility session (2026-08-14), pruned 2026-08-16. The session found four
gates; **the reload gate is gone** — a loaded plugin now hot-swaps in place
(`docs/plugins.md § Reloading one plugin without a restart`), so what was gate 3 no longer exists.
Each remaining gate is a deliberate decision with recorded rationale — not a gap someone forgot —
which means each is reversed by a decision plus its designed answer, not by rearchitecture.
Ordered by how hard they gate the end goal.

## 1. The node half is disclosed, not contained

**What.** A loaded plugin's node bundle runs in-process inside the Node. `permissions.node` shapes
the `ctx` the host hands it — undeclared facets are absent, `secrets`/`exec` default off — but the
bundle shares the process and can `import('node:fs')`, open `core.sqlite`, or monkeypatch globals.
`docs/security.md § Node-half plugin security` says this plainly, and every permission UI is
required to say *declared*, never *enforced*.

**Why it gates everything marketplace-shaped.** For plugins the user authored (the shipped dev
loop, `docs/plugin-authoring.md`), disclosure is the accepted deal — the human entered dev mode
for that plugin on that node. For a stranger's plugin found through discovery, disclosure-only
means the install prompt *is* the security model. That is bb's trade, refused on the record.
Shipping discovery before containment converts an honest, documented weakness into a liability.

**The designed answer.** `docs/security.md § The containment ladder`, rung 2: one child process
per plugin, a plugin-scoped token, a `--permission` fs jail, `ctx` becomes RPC. Rung 3 adds OS
sandboxing for network egress. Six design rules already enforced today were chosen specifically so
rung 2 stays a refactor: fetch-shaped route handlers, async-only ctx, structured-clone-safe
capabilities, no general secret read path, and friends. The reload path's candidate-then-commit
lifecycle is the supervision shape to reuse. This is the single biggest lift in the whole program
and the hard precondition for gate 2's discovery half.

## 2. No signing, no discovery

**What.** Installs are hash-pinned (the lockfile records source, resolved version, archive
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

## 3. External authors cannot install on a build they have

**Was**: "external authors cannot build a plugin", and that half is done. `npm create acorn-plugin`
writes the whole no-bundler profile (`packages/create-acorn-plugin`); `acorn-plugin-sdk` publishes
the frame bridge for anyone running a bundler (`packages/plugin-sdk`); the compatibility promise is
written down in `docs/plugins.md § What is published`, along with why the other seven facade
entrypoints are not published and never will be. With the authoring contract, roster rows that name
their own failure, the testkit and a reload-shaped loop already in place, building one is no longer
the gate.

**What.** Installing is. A local-path install is symlinked in place and gated on `allowLocalPath`,
which is `!app.isPackaged` under the desktop and `NODE_ENV !== 'production'` standalone. So the last
step of the authoring guide fails on every build an external author actually has: they can write a
plugin and not install it.

**Why it gates.** It is the whole remaining distance between "an afternoon" and "an afternoon, on a
machine that is not a dev checkout". Nothing downstream — discovery, a marketplace — is worth
anything while the local case does not close.

**The designed answer.** Generalize the local path into "point acorn at a folder of plugins" as a
first-class install source on the same trust flow (`work-plan.md § Phase 1`). Costed there as a
trust-boundary decision rather than an installer change: `allowLocalPath` is dev-only on purpose, and
widening it means saying what a symlinked, in-place-editable, unsandboxed node half may be on a
released build. It does not need rung 2 first — the bytes are the owner's own, chosen by absolute
path — but the reasoning belongs beside it in `docs/security.md`.

## What is deliberately not on this list

- **The 8 MiB frame cap and no-workers CSP.** Monaco proved some surfaces cannot live in a frame;
  the recorded answer is host-owned surfaces plugins borrow (`docs/third-party/monaco.md`), not a wider
  sandbox. That is a boundary, not a blocker — see `shell-vision.md`.
- **The closed action-verb set and descriptor vocabulary.** Rollbar's rail losing its filters was
  found honestly and answered with "move exploration into the frame." Growing the verb set is a
  per-verb decision, not a program — and it just grew deliberately (context menus, extension
  points, exclusive slots), which is the model: one designed addition at a time.
- **Plugin-to-plugin interop.** Capabilities, content links, ref resolvers, and the now-shipped
  cooperative extension points (`docs/plugins.md § Cooperative extension points`) cover it
  host-mediated. bb-style uncooperative extension is refused on the record and stays refused
  (`docs/plugins.md § There is no uncooperative extension`).

## Verify before building

Whether rung 2 has shipped (changes gate 1's risk text and the dev-grant note); whether the
lockfile still pins hashes and the installer still refuses downgrades; and whether
`@acorn/plugin-api` became publishable in the meantime (gate 3 closed).
