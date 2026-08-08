# Phase 5 — Install and update UX

**Size: M.** Requires Phase 2 (trust + distribution); lands best after 3/4 so there is something
worth installing. After this phase the full lifecycle — install, use, update, disable, uninstall
— works from Settings without touching a terminal, and the `ACORN_UNSAFE_PLUGINS` dev flag from
Phase 1 is removed.

## What exists to build on

- Settings → Plugins already lists the roster with per-node enable/disable and an honest
  `restartRequired` (`packages/node-core/src/server/routes/plugins.ts`,
  `packages/node-core/src/main/disabledPlugins.ts`).
- Phase 1 defined the install directory layout and manifest validation; Phase 2 defined hashes,
  the trust store, and the client cache.
- Mutations audit through the existing audit surface (`auditRequest` is already imported by the
  plugins route).

## Node-side installer

The installer runs **on the Node that will own the plugin** (install is per-node; a fleet is a
set of independently administered Nodes — no cross-node transaction, per
docs/architecture-overview.md).

New core routes (owner/device principal only, never task-scoped; `Idempotency-Key` required on
the mutations, per the API rules):

```text
POST   /v2/core/plugins/install        { source }         → { id, version, state }
POST   /v2/core/plugins/:id/update                        → { id, fromVersion, toVersion, state }
DELETE /v2/core/plugins/:id            { purgeData? }      → { restartRequired: true }
```

`source` forms, resolved in this order of preference:

- `{ "github": "owner/repo", "tag"?: "v1.2.0" }` — fetch the release asset named
  `acorn-plugin.tgz` (the convention this phase establishes; a public authoring guide documents
  it later) from the tagged release, latest release if no tag.
- `{ "npm": "pkg-name", "version"?: "1.2.0" }` — fetch the npm tarball.
- `{ "url": "https://…/plugin.tgz" }` — direct tarball; and `{ "path": "/abs/dir" }` for local
  development (dev builds only), which symlinks rather than copies.

Install steps (each idempotent, whole operation resumable):

1. Download the archive to a temp dir under the data root. Record its sha256.
2. Unpack; parse and validate `acorn-plugin.json` (Phase 1 schema — id rules, apiVersion gate,
   entrypoint confinement). Reject on any failure; nothing is placed in `plugins/` yet.
3. Compute entrypoint hashes (`dist/node.js`, `dist/client.js`).
4. Write `<dataRoot>/plugins/<id>/` atomically (unpack beside, rename into place) and the
   lockfile `<dataRoot>/plugins/<id>.lock.json`:
   `{ source, resolvedVersion, archiveSha256, entrypoints: { node?, client? }, installedAt }`.
5. Return `state: 'installed-restart-required'`. The plugin loads on next Node restart (Phase 1
   lifecycle; the roster row shows it immediately with its pending state).

Update = install with the same id: resolve the source from the lockfile, replace the directory
atomically, keep the plugin's SQLite file untouched. **Version must not decrease** unless the
request says `allowDowngrade: true`.

Uninstall: remove directory + lockfile. The plugin's SQLite file is **retained by default**
(mirrors today's disable semantics — docs/plugins.md: "SQLite files remain on disk and can be
re-enabled later"); `purgeData: true` deletes it after a confirmation step in the UI. Client-side
cache entries and trust acknowledgements for its hashes are garbage — Phase 2's eviction handles
the cache; leave acknowledgements (harmless, and they preserve "was accepted before" history).

Network note: the Node has no shared HTTP client abstraction (docs/http-client.md). The installer
is a legitimate new consumer — keep its fetch usage inside the installer module and revisit
against http-client.md's guidance rather than inventing a general client here.

## Client-side UX

Settings → Plugins grows three surfaces (per node, since install is per-node):

1. **Installed list** (extends the current roster UI): version, source, state
   (`active/failed/disabled/pending-restart/blocked-on-this-device`), enable/disable toggle,
   update button (visible when the source has a newer version — a manual "check for updates"
   action in v1, no background checking), uninstall with the purge-data confirmation.
2. **Install form**: GitHub `owner/repo`, npm name, or URL. Submitting calls the install route on
   the selected Node and then walks straight into the trust flow.
3. **Trust prompt** (Phase 2's, now reachable from a flow rather than only on connect): plugin
   name/id/version, the Node, the declared permission list rendered in plain language
   ("Read tasks", "Receive task events"), accept/reject. Render **both** permission groups and
   label them by enforcement level: UI scopes (`api`/`events`) as *enforced* — the bridge blocks
   anything undeclared — and the `node` block (`core` facets, capabilities, `secrets`, `exec`,
   `net`) as *declared* — shaped into the plugin's context (Phase 1) but, until node-half
   sandboxing ships, ultimately a statement of intent by code that runs with the Node's own
   access. The wording must not imply the `node` block is enforced; "This plugin's server code
   runs with the same access as acorn itself" is the honest footer line. On **update with
   changed permissions**, show the diff (added scopes highlighted, `node` additions most
   prominently) and require re-acceptance; unchanged permissions re-prompt only because the hash
   changed (framed as "Update to 1.3.0?"). Rationale for the wording and the update-as-attack-
   window posture: [node-security.md](./node-security.md).

Restart affordance: the roster already says `restartRequired`; give the pending state a
"Restart node" button wired to the existing supervised-restart path (Electron main supervises the
local Node — `apps/desktop/src/app/main/serviceHost.ts`; paired standalone Nodes surface
instructions instead).

## Audit

Every install/update/uninstall/enable/disable writes an audit record (existing audit
infrastructure; see `auditRequest` usage in the plugins route): actor, plugin id, versions,
source, archive hash. Trust accept/reject decisions are device-local and logged locally by main.

## Remove the dev flag

Delete `ACORN_UNSAFE_PLUGINS` (Phase 1). From this phase on, the loader loads whatever the
install directory contains, because everything in it arrived through the installer + trust flow.
Keep `{ "path": … }` dev installs behind a dev-build check.

## Tests

- Installer: each source form (mock fetches), atomic replace (kill mid-install leaves the old
  version intact), manifest rejection leaves no partial state, downgrade guard, purge semantics
  (DB retained/deleted), lockfile correctness.
- Routes: principal scoping, idempotency-key handling, audit rows written.
- Update permission diff: pure function over two manifests → added/removed scopes.
- e2e: install from a local tarball fixture through the Settings form → trust prompt → restart →
  plugin active; update with a permission change → diff prompt; uninstall → chrome and panes
  disappear after restart.

## Exit criteria

- Full lifecycle from Settings on both the local and a paired Node, no terminal involved.
- Mid-install crash cannot corrupt an existing installation.
- Permission-diff re-prompt on update works and is e2e-covered.
- `ACORN_UNSAFE_PLUGINS` gone.
- `pnpm lint`, suites, boundaries test, desktop e2e green.
