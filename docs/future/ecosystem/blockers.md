# The gates, and what answers each

From the ecosystem-feasibility session (2026-08-14), pruned 2026-08-16 and updated after rung 2
shipped. The session found four gates; **three are now gone**. The reload gate went first — a loaded plugin hot-swaps in place
(`docs/plugins.md § Reloading one plugin without a restart`). The authoring/install gate went on
2026-08-16, and its closing note is kept below because the argument it settles keeps coming back.
Each remaining gate is a deliberate decision with recorded rationale — not a gap someone forgot —
which means each is reversed by a decision plus its designed answer, not by rearchitecture.
Ordered by how hard they gate the end goal.

## 1. The node half is contained — **CLOSED**

Each loaded node half now runs in its own permission-scoped worker realm. The host sends only an
owner-bound, manifest-shaped RPC context; the worker may read its package and, when needed, write its
own exact SQLite paths. Direct `node:sqlite`, raw sockets, nested workers, native addons, and
undeclared child processes are refused. Reload keeps candidate-then-commit semantics across fresh
realms. The permission UI consequently renders these grants as *enforced*.

The acceptance test installs two hostile fixtures that try both ESM import and
`process.getBuiltinModule` paths to open `core.sqlite` and another plugin's database. Neither obtains
`DatabaseSync`. `docs/security.md § Rung 2 — Isolated Node realm` owns the boundary and its honest
limit: it is strong application-level isolation, not an OS adversarial sandbox or crash boundary.

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
update — is shipped, as is rung 2. Work plan: design signing first, then discovery as a listing
over signed packages.

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
install root beside it, so the symlink grants no new authority; every source gets the same isolated
node realm; and the client half is untouched because device consent is keyed on the hash of the bytes
that arrive, so an in-place edit re-prompts by itself.

**What it costs, and must keep saying.** A symlinked folder cannot be pinned. The lockfile records
`archiveSha256: null` and empty `entrypoints`, a test holds that, and the install form says so in its
own sentence. Folder installs sit outside the supply-chain story in gate 2 — signing will never cover
them. If someone later "fixes" the lockfile by recording digests for a `{ path }` source, that is not a
tidy-up; it is a claim of provenance the source cannot support.

## What is deliberately not on this list

- **The 8 MiB frame cap and no-workers CSP.** Monaco proved some surfaces cannot live in a frame;
  the recorded answer is host-owned surfaces plugins borrow (`docs/editor.md`), not a wider
  sandbox. That is a boundary, not a blocker — see `shell-vision.md`.
- **The closed action-verb set and descriptor vocabulary.** Rollbar's rail losing its filters was
  found honestly and answered with "move exploration into the frame." Growing the verb set is a
  per-verb decision, not a program — and it just grew deliberately (context menus, extension
  points, exclusive slots), which is the model: one designed addition at a time.
- **Plugin-to-plugin interop.** Capabilities, content links, ref resolvers, and the now-shipped
  cooperative extension points (`docs/plugins.md § Cooperative extension points`) cover it
  host-mediated, in five kinds (rows, annotations, remote trees, rectangles, hooks). bb-style
  uncooperative extension is refused on the record and stays refused
  (`docs/plugins.md § There is no uncooperative extension`).

## Verify before distribution

Verify that the rung-2 acceptance tests still deny core and peer database access, that the lockfile
still pins hashes for fetched sources, and that the installer still refuses downgrades.
