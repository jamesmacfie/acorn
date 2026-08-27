# Phase 2: make the toolchain enforce the architecture

Part of [phased-review-steps](./README.md). Everything here comes from
[the architecture review](../../reviews/2026-08-27-architecture-review.md) (findings 1, 2, 3, 7,
and 8). The theme is one sentence from that review: convert rules someone has to remember into
rules the toolchain knows. The later phases refactor seams and rename surfaces; this phase is what
makes those refactors safe to do.

## Work items

### 2.1 Real exports maps for plugin packages

Architecture review, finding 2, named there as the highest-leverage change available. 26 of 28
packages export `{"./*": "./src/*"}`, so the module system provides no encapsulation and the
boundary lives in 795 lines of AST walking in `tools/arch/boundaries.test.ts`, which gives no
editor feedback and reports only at test time.

The review verified the cost is low: every production import into a plugin already goes through
`node/`, `client/`, `main/index.ts`, or `contract/`, and `@acorn/plugin-api` already demonstrates
the shape with nine explicit subpaths. The work:

- Give each plugin package a four-entry `exports` map covering those entrypoints.
- The roughly 20 deep test imports in `apps/node/test/` (reaching `server/provider.ts`,
  `shared/api.ts`, and similar) either move into the plugin that owns the code or go behind a
  per-plugin `testkit/` entrypoint, the same medicine already applied one level up.
- Update `boundaries.test.ts`: rules the compiler now enforces can shrink or gain anti-vacuity
  assertions, and the baseline roots that existed only because the compiler could not stop them
  come out.

Side effect worth claiming in the commit message: the 580 exported names that appear only in
their own file (finding 8) stop being part of every package's reachable surface.

### 2.2 A UI test tier for the contribution hosts

Architecture review, finding 1, the only finding that worsens on its own. 175 `.tsx` files and no
test renders any of them; the e2e tier is deleted by choice; a worktree cannot run the app. Every
visual change is verified by one person looking at one screen.

Stand up a vitest project in `client-core` with jsdom and `vite-plugin-solid`, and write render
tests for the contribution hosts rather than individual panes, because ordering, capability
gating, arbitration, and error boundaries live in the hosts and every plugin's UI depends on them:

- `SlotHost` and `TaskSlotHost` in `registries/uiSlots.tsx`
- `RefPanelHost`
- `ContextMenuHost`
- `TaskPaneHost`
- `plugins/chrome/ExtensionPointHost.tsx`
- `plugins/ExclusiveSlotHost.tsx` (including the forced-throw fallback the live-QA checklist
  wants to see: a throwing `coreSlot` replacement flips back to core's implementation)

Two standing warnings from memory and the repo docs apply: the existing suites are node-env with
no Solid transform, so this must be a separate vitest project, not new cases in the old one; and
this tier verifies host machinery, not pixels, so [live-qa.md](../live-qa.md)'s eyes-on-pixels
pass stays necessary and is a good companion to run once this lands.

### 2.3 The Zod boundary rule

Architecture review, finding 3. The rule "parse request bodies with Zod at mutation boundaries"
is written down in `docs/architecture-overview.md` and drifted back: about 10 route files read
bodies with hand-rolled casts, the worst being `plugins/github/src/server/routes/prActions.ts`
with 11 unvalidated reads, including a merge method passed to GitHub unchecked. Core's own
`server/routes/prefs.ts` PUT does it too, though phase 1 separately device-gates that mount.

- Add a rule to `tools/arch`: any `c.req.json()` in a file with no `safeParse` in the same file
  fails, with a named allowlist for deliberate exceptions if any survive review.
- Fix the files it flags. The review names `github/prActions.ts` (start here; validate
  `merge_method` against the three legal values and the `viewed` route's `path`),
  `node-core/server/routes/prefs.ts`, `plugins/changes/src/server/routes/reviewNotes.ts`,
  `plugins/agents/src/server/routes/usage.ts`, `plugins/linear/src/server/routes/linear.ts`, and
  four more github route files; trust the rule's output over the list.

### 2.4 A docs link checker in CI

Architecture review, finding 7. Twelve of 159 source paths cited across `docs/` do not resolve;
four are dead files. The docs are the second implementation of the design, so a dead reference is
a bug, not a typo.

- A check (roughly 20 lines, run with the arch tests) that every repo path cited in `docs/`
  resolves, with a recorded convention for deliberate shorthand if any is kept.
- Fix the four dead paths the review names: `apps/desktop/src-tauri/src/updater_owned.rs`,
  `apps/desktop/src/app/main/pluginScheme.ts`,
  `packages/client-core/src/plugins/chrome/RailMarkerRuntime.tsx`, and
  `plugins/docker/src/client/DockerRailBadge.tsx`, plus whatever the checker finds beyond them,
  since the rail-marker landing will have moved files.

This checker also protects this folder: every phase file here cites paths that rot.

### 2.5 One atomic file write

Architecture review, finding 8. `writePrivateAtomic` in
`packages/node-core/src/main/dataRoot.ts` is the canonical open-write-fsync-close-rename at mode
0600. Four files in the same folder open-code the sequence: `activeIdentity.ts`,
`pluginInstaller.ts`, `bundledPluginState.ts`, and `disabledPlugins.ts`. Call the helper.
Separately, decide the desktop-helper question the review raises: `pluginTrustStore.ts` and
`pluginCache.ts` hold a looser variant with no fsync, and trust records arguably need the same
durability. Decide and record; do not silently unify.

### 2.6 Delete the legacy persisted-state readers

Architecture review, finding 8. Every persisted-state slice carries a `legacy` reader for
pre-migration preference keys, in an app with a user base of one and no auto-update. Confirm one
clean migration on the live data root, then delete the lot in a single commit. Do this after the
phase 0 commit so the rail-marker slice's own migration is included in the confirmation.

### 2.7 Name the pinned plugins

Architecture review, finding 8. `NodePluginDeps` passes constructor dependencies to four plugins
and `dataDir` to three, which a loaded plugin can never receive. Add a line to
`docs/first-party-plugins.md` naming those plugins as pinned to the compiled tier for that
reason, so [compiled-tier.md](../compiled-tier.md)'s census and the tier table in phase 3 agree
with the composition root.

## Acceptance

- `tsc --noEmit` fails on a deep import into a plugin package from outside it; the corresponding
  arch-test baselines are removed or shrunk with anti-vacuity floors adjusted.
- A jsdom test project renders all seven contribution hosts and asserts ordering, gating, and the
  error-boundary fallback; `pnpm --filter @acorn/client-core test` runs it.
- The Zod rule is live in `tools/arch` and the tree is clean under it.
- The link checker is live and `docs/` is clean under it.
- One `writePrivateAtomic`; the desktop-helper fsync decision is recorded where the variant
  lives.
- The `legacy` readers are gone and the deletion commit records the migration confirmation.

## Verify before building

- Re-count the deep test imports before designing the testkit entrypoints; the review counted 20
  edges in `apps/node/test/` on 2026-08-27 and phase 0's landing may have moved them.
- Check whether `vitest.config.ts` in client-core still documents the no-render limitation; the
  new project's config should replace that comment with a pointer to the host tests.
- Re-run the review's Zod census (`c.req.json()` without `safeParse`) rather than trusting the
  file list; phase 1 touches several of the same files.
- Confirm the four dead doc paths are still dead; the working tree deletes and adds files daily.
