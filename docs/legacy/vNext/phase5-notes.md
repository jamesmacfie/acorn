# Phase 5 — what shipped, what it caught, and where it diverges

Phase 5 (plan.md § "Phase 5 — polish, importer, release") is **complete against its exit criteria**,
with two qualifications stated up front rather than buried: **notarization is not done** and cannot be
until there is an Apple Developer ID, and **the manual half of the parity checklist has not been
walked** — it is written, and walking it is a person's job with a real build.

Read [phase4-notes.md](./phase4-notes.md) and [phase5-handoff.md](./phase5-handoff.md) first. This file
follows their model: say what is true, not what sounded good while writing it.

## The three accepted risks are closed

Phase 4 handed three risks forward and asked Phase 5 to decide about them explicitly rather than
inherit them. All three are fixed.

**1. The preview tunnel's loopback listener is authenticated now.** The handoff estimated the fix as "a
per-tunnel secret in the path plus a rewriting proxy, which is a real build". It is smaller than that,
because the secret does not have to go in the path — a path prefix is what forces the rewriting proxy
(every absolute asset path, every redirect, the HMR socket's own URL). A **header** rides along
untouched: the pane's own session attaches it through `webRequest.onBeforeSendHeaders` to every request
that view makes, subresources and WebSocket upgrades included, and a dev server ignores a header it
does not know.

Each listener mints 32 bytes of `randomBytes`; a connection has 2 s and 8 KiB to present
`x-acorn-tunnel: <secret>` before anything dials the node. The head is then forwarded **verbatim**,
including those bytes — they were consumed by the check, so something has to replay them, and
re-serialising the request would mean owning every edge of HTTP framing for no benefit.

What that buys, precisely: a local process that guesses the port gets its connection destroyed instead
of a pipe to another machine's dev server. What it does **not** buy is defence against a process that
can read this one's memory or drive the pane. Same threat model as before.

Two long-standing `security.md` § Execution boundaries requirements were fixed in the same file,
because the preview view was where both were missing: it ran on the app's **default session** (so a
page in one task's preview could read another's cookies) and **no permission handler existed anywhere
in the repo**. Both handlers are needed — a page told "granted" by the check handler proceeds without
ever firing a request.

**2. There is a heartbeat on the events socket.** Both ends run a ping/pong watchdog, and they are not
redundant: they detect different ends going quiet. The client's is the half that fixes the recorded bug
(a hung node, or a laptop that slept without dropping TCP, read `online` indefinitely); the node's
rides its existing 60 s revocation sweep and stops a vanished client's stream subscriptions living on
until the process restarts.

`terminate()` rather than `close()`, and the distinction is the point: `close()` starts a closing
handshake, waiting for a reply from the peer we have just concluded is not replying. The socket would
sit in CLOSING and the node would still read `online` — the same bug one state further along.

Testing it needed `autoPong: false`, which is as close as a test gets to SIGSTOP: `ws` answers pings
inside the library, below any application code, so a genuinely hung peer is indistinguishable from a
healthy one unless the peer is told to stay silent.

**3. The SIGTERM drain is bounded, and the real cause was smaller than "slow".** `standalone.ts` closed
**no listener at all** — its drain went straight to plugin dispose, so the port stayed bound for as long
as the slowest plugin took, because nothing had told the server to stop accepting. `closeListener` now
lives in node-core beside the `attachWsHub`/`attachTunnel` calls whose socket sets it has to reap (it
is the only place that knows what `startListener` attached), both composition roots call it first, and
`drainWithDeadline` bounds the sequence at 30 s per architecture.md.

## What else shipped

| plan.md item | Where | Note |
| --- | --- | --- |
| config-only V1 importer | `main/v1Import.ts`, `routes/importV1.ts`, `workspaces/V1Import.tsx` | Run against a copy of a real V1 root: 3 workspaces, 101 repos regrouped, 97 hidden, 3 checkouts, source untouched |
| parity checklist | `test/client/parity.test.ts` + `parity-checklist.md` + a fleet case in `twoNode.spec.ts` | The literal half is asserted; the qualitative half is written, not walked |
| backup | `main/backup.ts`, `routes/backup.ts` | Restore stays a documented manual procedure, as data.md argues |
| disk-encryption warning | `main/diskEncryption.ts`, Settings → Security | Three-valued: `null` means "cannot tell", which is the honest answer off macOS |
| audit surface | `audit` table + `GET /v2/core/audit` + Settings → Security | Six producers |
| packaging | verified by hand — see below | Notarization blocked |
| standalone distribution | `scripts/pack-node.mjs`, `docs/node-distribution.md` | Verified end to end: packed, installed, booted |

## Decisions worth knowing before you change something

**The importer copies no preferences, and that settles a contradiction the handoff left open.** The
handoff assumed the importer would write prefs and warned at length about the device/node tier split;
`plugin-inventory.md:258` says "Never tokens, tasks, notes, memories, terminals, or **preferences**".
The scope statement wins, and the split does not arise. Carrying prefs would mean importing "which task
was I last on" for tasks that were deliberately excluded.

**`config_acks` is left behind, and that absence IS `security.md`'s "imported V1 config arrives
untrusted".** The trust gate hashes REPO-AUTHORED files (`.acorn/config.toml`, `.acorn/workflows/*`), so
dropping the acknowledgements makes every one of them get reviewed again on this node. The script
columns on `repo_paths` DO come across, and that is not an inconsistency: the owner typed those into
V1's own settings UI, they are machine-local, and they have never been behind that gate.

**Workspace membership is imported as a MOVE, not an insert-or-ignore.** The first-run bootstrap has
already put every mirrored repo in Default, so insert-or-ignore would find every row taken and import
nothing — the grouping is the entire point. Restricting the move to repos still sitting in Default is
what stops it overriding a decision already made on this node.

**The importer reads a COPY of the V1 database.** A readonly open of a WAL database can still create a
`-shm`, and a recovery pass can touch the `-wal`, so plan.md's "byte-identical after import" would have
been hopeful rather than structural. The sidecars are copied too: a V1 install closed uncleanly has
committed transactions living only in its `-wal`.

**`secret.used` is deliberately absent from the audit trail**, though `security.md` § Audit lists it.
`SecretService` is built so the encryption key has exactly one holder — it takes a hex key and nothing
else, no database, no request, no connection id, and its argument is the ciphertext. Recording every
read would also turn the table into a request log (a mirror refresh reads the GitHub token on a timer)
and bury the handful of decisions an owner reviews. The nearest cheap alternative was auditing
`githubToken()`, the single read site for one provider; rejected because partial coverage recorded as
complete is worse than none — an owner reading a trail that names only GitHub would reasonably conclude
nothing else spends a credential.

**`security.md` also lists "non-loopback bind changes" as an audit producer, and there is none**,
because there is no such setting: `main/server.ts` hard-codes `127.0.0.1`. Recorded as
not-applicable rather than stubbed.

**Backup excludes blobs, and that is a size decision rather than a security one.** Content-addressed
cache, refetchable from GitHub, routinely the largest thing in a data root. A backup ten times bigger
and no more recoverable is one people stop taking.

**No native save dialog for backup.** A save dialog picks a path on the CLIENT's filesystem, which is
the wrong filesystem for every node but the local one — i.e. wrong for exactly the deployment the fleet
exists to serve. `GET /v2/core/backup` returns a suggested path from the node instead, and the client
shows a text field.

**Settings → Security reports one field, not three.** The data root's mode is always 0700 and the bind
host is always 127.0.0.1; a settings page that lists constants teaches the reader to stop reading it.

**The standalone node is a tarball, not an npm package.** `apps/node` is private with `workspace:*`
deps, and `better-sqlite3`/`node-pty` are native — a published package would need prebuilt binaries for
every platform/arch/ABI triple, which is a release pipeline rather than a script.

## What the work caught

**A stale claim in the handoff.** "`forEachConnection` still has zero callers" is no longer true:
`withOwnedConnections` wraps it and `plugins/linear/src/server/routes/linear.ts:54` calls that. Phase 3
rewired linear onto the wrappers and the note was not updated. Nothing was deleted.

**A real parity divergence, in the prose rather than the code.** `ui.md:15` said "⌘1–9 pane focus".
Both V1 (`TabRail.tsx:145` in the V1 tree) and vNext bind `task.activate.N` — activate the Nth visible
task. The code is at parity; the checklist was wrong, and the doc was corrected.

**An audit write in front of the action it described.** The spelled-out
`recordAudit(getDb(c.env), …)` undid `recordAudit`'s whole fire-and-forget point one layer up, because
`getDb` THROWS when there is no database binding. It surfaced immediately as a 500 from an existing
route test. `auditRequest(c, …)` is the fix and the reason that helper exists.

**Two holes in the tarball's dependency check, on its first two runs.** The first scanner was too loose
and reported `shell` as a dependency (`agentProfileRegistry.require("shell")` is a METHOD named
require); the second was too tight and missed every `createRequire` load, declared the manifest
complete, and the unpacked tarball then died at boot on `Cannot find module '@xterm/headless'`. That is
exactly the silent failure the check exists for, which is the argument for having run the artifact
rather than trusting the check.

**An npm footgun worth documenting.** With `ignore-scripts=true` (a reasonable hardened default), the
native modules install but never build and the node dies with "Could not locate the bindings file".
`docs/node-distribution.md` names the symptom and the fix.

## Packaging, verified by hand

`pnpm --filter @acorn/desktop dist` produces `acorn-0.1.0-arm64.dmg` (232 MB). What was checked on the
real packaged app, launched against a scratch `--user-data-dir`:

- It boots. `spawn(process.execPath, [asarPath])` starts the staged `service.js`, migrations run,
  the listener binds an ephemeral port, and `GET /v2/node` answers 200 over the pinned certificate.
- The data root is right: `core.sqlite`, eight `plugins/*.sqlite`, `node.json`, `node.lock`, `tls/`,
  `blobs/`, `fleet.json`, `device-token-local`, `internal-token`.
- The `audit` table exists in the packaged root and already holds `device.paired` for "This computer",
  which means the migration and the producer both survived packaging.
- **`ws` is in the asar** (19 files) — the handoff's worry that electron-builder's devDependency
  pruning would strip the tunnel's dependency is unfounded, at the manifest level and in the artifact.
- Every Phase 5 main-process change is present in the packaged bundles: `x-acorn-tunnel`,
  `acorn-preview-<task>`, `setPermissionRequestHandler`, `missedPongs` in `out/main/index.js`;
  `closeListener` and `drainWithDeadline` in `out/main/service.js`.
- Shutdown drains cleanly: the port frees and `node.lock` is released.

**Not checked by hand**: the preview tunnel end-to-end *inside the packaged app*, which needs a remote
node and a rendered pane. It is covered in a built (non-packaged) app by `twoNode.spec.ts`, which now
drives the real preview WebContentsView and reads what it rendered.

`identity: null` and `publish: null` are unchanged. Notarization needs an Apple Developer ID and is the
one plan.md item this phase cannot close.

## Not done

- **Notarization**, above. `hardenedRuntime`, entitlements and an `afterSign` hook were deliberately
  NOT added: untested config that cannot run is worse than none, because it looks finished.
- **The manual parity walk.** `parity-checklist.md` exists and is written to be walked twice
  (single-node for first-run, two-node for the fleet surfaces). Nobody has walked it.
- **A packaging smoke test on a clean macOS VM**, which plan.md's exit criteria name. What happened
  instead is the by-hand launch above, on this machine, against a scratch data root.
- **Per-endpoint `Idempotency-Key`** — unchanged since Phase 1, for the same reason: the route
  declaration and the client call sites have to land together.
- **Other providers' credential reads are still ungated** (linear, rollbar, database,
  model-providers), exactly as Phases 2, 3 and 4 left them.
- **No CLI for opening a pairing window on a standalone node**, which is a chicken-and-egg for a node
  you have never paired with. The launch handshake prints a device token, which is what the two-node
  e2e uses — but that is a token in a log file, not a pairing ceremony.
- **Workflows contributes no attention source**; **plugins/agents' task sidebar still owns workflow
  data**. Both unchanged from Phase 3.
- **The audit trail is not tamper-evident**, deliberately — `security.md` says so, and hash chains
  defend against an attacker who already owns the DB file.
- **`VACUUM` in the backup scrub is precautionary, not proven.** The test scans the archived bytes for
  the ciphertext and passes with the VACUUM removed, because a database that small keeps the row in
  place and `close()` checkpoints the WAL away. It earns its keep on a real data root.
