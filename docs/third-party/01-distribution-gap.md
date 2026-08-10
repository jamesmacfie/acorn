# 01 — Bundled-plugin distribution

**Resolved.** Original severity: blocker.

## Resolution

The desktop build now stages Rollbar as a normal loaded-plugin package under
`out/bundled-plugins`, and electron-builder ships that directory as application resources. The
desktop passes the trusted resource directory to the service; before plugin discovery the service
reconciles those packages into `<dataRoot>/plugins/`.

The policy is generic rather than Rollbar-specific:

- a missing package is seeded on first boot;
- an app-owned package is atomically updated when its packaged fingerprint changes;
- an unknown or owner-installed package with the same id wins and is never overwritten;
- uninstall writes an external tombstone, so app restart or upgrade cannot resurrect it;
- package databases and the core database are outside the replaced directory and remain untouched;
- packaged client bytes are cached and accepted by Electron main from application resources. A
  remote node's roster cannot claim this trust path.

`bundledPlugins.test.ts` covers fresh seed, app update, owner override, sticky uninstall, and a real
pre-existing database containing a Rollbar connection/secret reference, task origin and task link.
`bundledPluginTrust.test.ts` binds the automatic client acknowledgement to the exact locally hashed
resource bytes. Adding the next bundled plugin is one entry in
`apps/desktop/scripts/build-bundled-plugins.mjs`; the rest of the lifecycle is shared.

## Original finding

Rollbar is gone from `apps/node/src/server/plugins.ts` and
`apps/desktop/src/app/client/plugins.ts`. Nothing replaces it on a user's machine:

- The only thing that produces the package is a **developer script** —
  `pnpm --filter @acorn/node build:plugin rollbar` — which writes into the local dev data root.
- Nothing packages it. `apps/desktop/electron-builder.*` has no `extraResources` entry for it, and
  `apps/node/package.json`'s `@acorn/plugin-rollbar` dependency is a workspace source dependency,
  not a shipped bundle.
- Nothing seeds it. `pluginInstaller.ts` has no bundled-package path, and the loader only scans
  `<dataRoot>/plugins/`.
- Nothing publishes it. There is no release asset, no npm package, no URL for
  `POST /v2/core/plugins/install` to resolve.

So on the next release, a user who has Rollbar connected gets:

- no `rollbar` provider registered, so `/v2/p/rollbar/*` 404s;
- no rail source, no detail pane;
- stored Rollbar connections and secrets still in the database, referencing a provider nothing
  registers;
- existing tasks carrying Rollbar links and a `rollbar` origin, rendering through the
  unknown-origin fallback;
- and no action available to fix it, because there is nothing to install.

The plugin's own doc anticipated "an installer-driven update" as release validation. This is a step
before that: there is no artifact for an installer to drive.

## Why it matters more than it looks

This is the first time a shipped feature has moved out of the binary, so it is also the first time
the product has needed an answer to "what happens to the users who already had it". Whatever is
chosen here becomes the pattern for linear, http, database and editor. Getting it wrong once is a
support thread; getting it wrong four more times is a migration policy nobody decided on.

## Options

**A. Bundle and seed (recommended).** Ship the built package inside the app artifact and have the
Node place it into `<dataRoot>/plugins/rollbar/` on first boot if absent, with a lockfile marking
its source as `bundled`.

- Upgrade continuity is preserved: the user notices nothing.
- It gives the loaded tier a first-class concept it will need anyway — *plugins we ship, loaded
  rather than compiled* — which is the honest description of what Rollbar now is.
- Decisions this forces, and they are the real work: does a bundled package prompt for trust on
  first sight (it should **not** — the bytes came from the app the user already installed, and the
  same signature covers both), can the user uninstall it (yes, and reseeding must not resurrect
  something they removed — record the uninstall), and what happens when the app updates and the
  bundled version is newer than the installed one (replace, unless the user installed a different
  version deliberately).

**B. Publish and prompt.** Release the package to a URL or npm, and have the app detect a
disconnected-but-configured Rollbar and offer to install it.

- Exercises the real install path end to end, which is worth something.
- But it is a visible break for every existing user, requires network at upgrade time, and needs a
  migration-prompt surface that does not exist.

**C. Keep Rollbar compiled in until A or B exists.** Revert the composition-list removal, keep
everything else. The loaded package stays the dogfood it already is.

- Zero user impact, and the review's other findings still get fixed.
- Costs the thing the move was for: with Rollbar compiled in, the fetch seam again has no
  production caller.

## Recommendation

**A**, and treat the bundled-plugin concept as the deliverable rather than a Rollbar workaround —
because the next four migrations need it too. If A cannot land in this release, **C** is the right
holding position; do not ship the removal with no artifact behind it.

## Acceptance record

- [x] Fresh profiles are seeded before plugin discovery.
- [x] Rollbar connections, secret references, task links and task origins survive the transition in
  a migrated real-database test.
- [x] Uninstalling sticks across an app update.
- [x] The mechanism is documented and shared by future bundled migrations.
