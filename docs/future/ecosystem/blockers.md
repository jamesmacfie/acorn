# The gates, and what answers each

From the ecosystem-feasibility session (2026-08-14), pruned 2026-08-16. The session found four
gates; **two are now gone**. The reload gate went first — a loaded plugin hot-swaps in place
(`docs/plugins.md § Reloading one plugin without a restart`). The authoring/install gate went on
2026-08-16, and its closing note is kept below because the argument it settles keeps coming back.
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

## 3. External authors cannot install on a build they have — **CLOSED 2026-08-16**

Both halves are done. Building: `npm create acorn-plugin` writes the whole no-bundler profile
(`packages/create-acorn-plugin`) and `acorn-plugin-sdk` publishes the frame bridge for anyone running a
bundler (`packages/plugin-sdk`), with the compatibility promise in `docs/plugins.md § What is
published`. Installing: `allowLocalPath` is gone, and `{ path }` — an absolute directory on the node's
own filesystem — is a first-class install source on every build, packaged included. Settings → Plugins
offers a native folder picker when the target node is this machine.

**Kept because the argument recurs.** The decision was a trust-boundary one, not a config flag, and
`docs/security.md § Installing from a folder` holds it in full. The short form: a folder install is the
owner naming bytes already theirs, and anyone who can rewrite that directory can already rewrite the
install root beside it, so the symlink grants no new authority; the node half is uncontained for every
source alike, which is gate 1's problem and not this one's; and the client half is untouched because
device consent is keyed on the hash of the bytes that arrive, so an in-place edit re-prompts by itself.

**What it costs, and must keep saying.** A symlinked folder cannot be pinned. The lockfile records
`archiveSha256: null` and empty `entrypoints`, a test holds that, and the install form says so in its
own sentence. Folder installs sit outside the supply-chain story in gate 2 — signing will never cover
them. If someone later "fixes" the lockfile by recording digests for a `{ path }` source, that is not a
tidy-up; it is a claim of provenance the source cannot support.

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

Whether rung 2 has shipped (changes gate 1's risk text and the dev-grant note); and whether the
lockfile still pins hashes for fetched sources and the installer still refuses downgrades.
