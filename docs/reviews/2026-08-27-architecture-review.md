# Architecture review, 2026-08-27

A read-only survey of the tree at commit `8e773d70`, with the working tree's uncommitted rail-marker
work in place. I measured against the four things you asked about: an understandable and testable
architecture, boundaries between the systems, drift from the design goals in `docs/`, and the API a
plugin author has to learn.

Read the findings section first. The health baseline is there so you can see what I ruled out.

## Health baseline

I went looking for the usual signs of a codebase that has outgrown its shape and did not find them.

- 160,700 lines of TypeScript and Rust, split 108,476 production and 52,227 test.
- The largest file is `packages/node-core/src/main/pluginManifest.test.ts` at 1,178 lines. The largest
  production file is `packages/client-core/src/ui/primitives.tsx` at 1,147. Nothing else in production
  passes 800. There are no god files.
- Five `as any`, one `@ts-expect-error`, zero `TODO`, `FIXME`, `HACK`, or `XXX`. The 104 `as unknown as`
  casts are 50 test files and 15 production files, and the production ones sit on library seams:
  `node:http` upgrade handling, Drizzle's constructor, `BodyInit`.
- `pnpm lint` is green. That is oxlint plus `tsc --noEmit` in all 28 packages.
- 18% of non-blank production lines are comments, and they explain why rather than what. That is the
  single best thing about this codebase.
- `tools/arch/boundaries.test.ts` holds 31 rules over the real import graph. Most of its shrinking
  baselines are empty, and several carry anti-vacuity assertions so a rule cannot pass by measuring
  nothing.
- Plugin production code has zero facade violations across more than 200 `@acorn/plugin-api` edges.
- `CoreServices` is 11 named services with projection types at each edge, not a god object.

So the problems below are not slop. They are the second-order costs of building 60 extension points
in nine weeks, and one of them is load-bearing.

## Findings

### 1. Nothing verifies the user interface

175 `.tsx` files, 28,185 lines, and no test renders any of them. There is no jsdom, no happy-dom, and
no `@solidjs/testing-library` anywhere in the repo. `packages/client-core/vitest.config.ts` says so in
a comment: "a green suite here proves nothing about the UI." The `client` project in
`apps/desktop/vitest.config.ts` loads `vite-plugin-solid` but runs under `environment: 'node'`, so it
boots the graph and snapshots registries without ever mounting a component.

The e2e tier is gone by choice. A worktree cannot run the app, because it has no `.env` and port 4317
belongs to your live instance. Add those together and every visual and interaction change in the
product is verified by one person looking at one screen, once.

This is the largest hole against "testable". It is also the one that gets worse fastest, because the
component count grows with every contribution kind.

What I would do: add a `client-core` vitest project with jsdom and `vite-plugin-solid`, then write
render tests for the contribution hosts rather than for individual panes. `SlotHost` and `TaskSlotHost`
in `registries/uiSlots.tsx`, `RefPanelHost`, `ContextMenuHost`, `TaskPaneHost`, and
`plugins/chrome/ExtensionPointHost.tsx` with `plugins/ExclusiveSlotHost.tsx` are where ordering,
capability gating, arbitration, and error boundaries actually live. Seven files of tests would cover
the machinery every plugin's UI depends on.

### 2. The boundaries are enforced by a test, not by the module system

Every package except two exports `{"./*": "./src/*"}`. That is 26 of 28, including all 18 plugins.
The architecture doc is candid about the consequence: "the module system no encapsulation, so any
package can reach any file in any other, and the boundaries have to be a test rather than a build
error."

`tools/arch/boundaries.test.ts` is a good test. It is also 795 lines of hand-maintained AST walking
that reports at test time, which means no editor feedback, no autocomplete narrowing, and 15 baseline
roots that exist only because the compiler cannot stop them.

The fix is cheaper than it looks, and the repo already proves it twice. `@acorn/plugin-api` publishes
nine explicit subpaths in nine lines of `package.json`. And I checked what consumers actually import
from plugins: every production import already goes through `node/`, `client/`, `main/index.ts`, or
`contract/`. The only deeper imports in the tree are 20 edges in `apps/node/test/`, which reach
`server/provider.ts`, `shared/api.ts`, and similar.

So a four-entry exports map per plugin would turn one class of boundary violation from a test failure
into a compile error, today, without touching production code. The cost is the same medicine you have
already applied one level in: those integration tests need a `testkit/` entrypoint per plugin, or they
move into the plugin that owns the code.

I would treat this as the highest-leverage change available. It converts a rule someone has to
remember into a rule the toolchain knows.

### 3. The Zod rule at mutation boundaries has drifted back

`docs/architecture-overview.md` states the rule and the reason it exists: "Roughly ten route files
parsed with Zod while others hand-rolled `typeof` chains, and the chains were where the bugs hid."

Ten files now read a request body with no schema, about 25 body reads out of 114 across the server.
The worst is `plugins/github/src/server/routes/prActions.ts` with 11:

```ts
const { method } = (await c.req.json().catch(() => ({}))) as { method?: string }
```

Four lines later that becomes `merge_method: method ?? 'merge'` in the GitHub request body, with no
check against `MERGE`, `SQUASH`, or `REBASE`. The `viewed` route further down stores `path` as a
database key after a bare truthiness check, so an arbitrary string lands in the table. Drizzle
parameterizes it, so this is unvalidated data rather than injection.
`packages/node-core/src/server/routes/prefs.ts` does the same thing on its `PUT`, in core, in the
package that documents the rule.

The others are `plugins/changes/src/server/routes/reviewNotes.ts`, `plugins/agents/src/server/routes/usage.ts`,
`plugins/linear/src/server/routes/linear.ts`, and four more `github` route files.

None of this is reachable without an authenticated device token, so severity is low. Drift is the
point. The rule was written down because hand-rolled chains hid bugs, and hand-rolled chains came
back. A boundary rule in `tools/arch` that fails any `c.req.json()` without a `safeParse` in the same
file would hold it, and would have caught all 10.

### 4. Plugin tests are written against core internals

141 imports in plugin test files reach past `@acorn/plugin-api` into 15 root modules of `client-core`
and `node-core`: `server/db`, `main/core`, `server/middleware`, `client-core/registries`,
`client-core/ui`, and so on. The arch test tracks this and records the migration's progress in a
comment: "167 across 48 files the day before the testkit landed; 147 across 37 once the first eleven
moved."

That migration moved 20 imports and stopped. The gap matters more than the number, because it tells
you what an external author cannot do. A first-party plugin tests its routes by importing
`@acorn/node-core/testkit/db.ts` and building a real SQLite database. A third-party author has
`@acorn/plugin-api/testkit`, which carries 14 exports. They cannot write the tests you write.

If third-party plugins are the goal, the testkit is the missing half of the front door, and the 141
imports are the specification for it. Each one names a thing plugin authors need and do not have.

### 5. There are two plugin APIs, not one API with two trust levels

The compiled tier registers through TypeScript: 22 named contribution points on `ClientPluginContext`
plus 14 on `NodePluginContext`, each strongly typed, each discoverable by autocomplete. The loaded
tier registers through JSON: 20 descriptor arrays in `contributions`, validated by an 818-line Zod
schema in `packages/protocol/src/pluginContract.ts`.

> **Updated 2026-08-27**, after the consistency review landed. The counts are 23 and 11. On the node,
> `nodeActions`, `harnesses` and `log` came off the authoring type (the first two are host seams filled
> from the manifest, the third was dead). On the client, task slots folded into `slots`, and brand marks
> and content links came UP off the `ctx.contribute` escape hatch into named members — which is why the
> client count rose while the surface shrank. The two tiers are two APIs either way; that is the
> finding, and it stands.

They overlap but do not match. The compiled tier has panes, ref panels, client schedules, rail
markers, persisted state, settings pages, project importers, and agent-tool renderers that the manifest
cannot express. `docs/architecture-overview.md` explains why, and the reasoning is sound: some
contributions need the shared realm. The cost is that "learning the acorn plugin API" means learning
two of them, and which one you learn depends on a trust decision made elsewhere.

The vocabulary is also growing fast. Distinct `*Contribution` type names in the tree:

| Date | Contribution kinds |
| --- | --- |
| 2026-07-09 | 10 |
| 2026-07-20 | 37 |
| 2026-07-28 | 44 |
| 2026-08-13 | 57 |
| 2026-08-27 | 60 |

`packages/client-core/src/registries/` went from 27 files to 37 in the two weeks after it was created,
then held flat for two. Each kind is individually justified, and I read the justifications. Each also
costs a registry module, a host component, a manifest field, a doc section, an arbitration rule, and a
line in whichever context type it hangs off.

I do not think any one of these should be removed. I do think the growth rate is the thing to watch,
and that "what would it take to add contribution kind 61" is the question that tells you whether the
model is holding. Right now the answer is roughly eight files.

Two things would help without a redesign. First, publish one table that maps every contribution kind
to its tier, its registration mechanism, and its host, so an author can see the whole surface on one
page. Second, get the loaded tier to parity for the kinds that are expressible as data, so the manifest
stops being a subset an author discovers by failing.

### 6. Six test packages are red

`turbo run test --continue` gives 23 of 29 tasks passing, with eight failures. Five are golden lists
waiting on the in-flight rail-marker work, which is the tests doing their job:

- `apps/node` `routeRegistry.test.ts`, 184 routes against a golden 177.
- `apps/node` `pluginDisable.test.ts`, 28 routes against 27.
- `apps/desktop` `persistedState.conformance.test.ts`, 5 slices against 4.
- `tools/arch` "no plugin stylesheet styles another package's markup", six survivors against five.
- `client-core` `ui/adoption.test.ts`, `plugins/terminal/src/client/slotContribution.tsx` uses a raw
  control.

Three look like test-quality bugs rather than product bugs, and they are worth fixing because a test
that fails for its own reasons trains people to ignore the suite:

- `plugins/http/src/server/send.test.ts` fails comparing two paths that print identically after
  truncation. That is almost certainly `/tmp` against `/private/tmp` on macOS, so the test needs
  `realpathSync` on both sides.
- `plugins/agents/src/main/drivers/acpDriver.test.ts`, "starts a fresh provider session when the agent
  no longer has the stored one", expects one call and gets none.

### 7. Docs carry a second implementation of the design

81 markdown files, 1.14 MB. `plugins.md` is 133 KB, `dashboards.md` 65 KB, `security.md` 55 KB,
`plugin-authoring.md` 52 KB, `ui-design.md` 51 KB.

The prose is genuinely good, and the practice of keeping the reasoning beside the code is why this
codebase is followable at all. The risk is that a contract described in 133 KB of prose and enforced
in 795 lines of test has a third copy in the code, and only two of the three can be checked. That
`prefs.ts` PUT in finding 3 is an example: the rule is written down twice and broken once.

Concretely, 12 of the 159 source paths cited across `docs/` do not resolve. Eight are shorthand that a
reader can follow, such as `plugins/frames/sdk.ts` for
`packages/client-core/src/plugins/frames/sdk.ts`. Four are dead:
`apps/desktop/src-tauri/src/updater_owned.rs`, `apps/desktop/src/app/main/pluginScheme.ts`,
`packages/client-core/src/plugins/chrome/RailMarkerRuntime.tsx`, and
`plugins/docker/src/client/DockerRailBadge.tsx`. The last one is deleted in your working tree right now.

A link checker over `docs/` in CI is 20 lines and would keep this at zero.

### 8. Smaller things

**The atomic file write is open-coded five times.** `writePrivateAtomic` in
`packages/node-core/src/main/dataRoot.ts` is the canonical version, and `sessionKey.ts` calls it. Four
files in the same folder repeat the `openSync` with mode `0o600`, `writeSync`, `fsyncSync`,
`closeSync`, `renameSync` sequence instead: `activeIdentity.ts`, `pluginInstaller.ts`,
`bundledPluginState.ts`, and `disabledPlugins.ts`. All four can call the helper next door.
`desktop-helper`'s `pluginTrustStore.ts` and `pluginCache.ts` hold a looser variant with no `fsync`,
which is a separate question about whether trust records need the same durability.

**The composition root has two back channels into plugins.** `NodePluginDeps` passes constructor
dependencies to 4 of 11 plugins, and `dataDir` goes to 3. The comment is honest about what this is:
"runtime seams that are not domain contracts." It is also the one thing a loaded plugin can never
receive, so any behaviour that depends on it cannot migrate out of the binary. Worth a line in
`first-party-plugins.md` naming those four as pinned for that reason.

**Every persisted-state slice carries a `legacy` reader** for pre-migration preference keys, in an app
that has never shipped publicly and has no auto-update. That is migration debt maintained for a user
base of one. I would keep it until you have confirmed one clean migration on your own data root, then
delete the lot in a single commit.

**580 of 3,652 exported names appear only in their own file.** I sampled six and they are all local
type vocabulary, exported by habit rather than need, so this is not dead code. It is worth one line
only because `{"./*": "./src/*"}` makes all 580 part of every package's reachable surface. Finding 2
fixes it as a side effect.

## What I would do, in order

1. Give plugins a real `exports` map, four entries each, and move the 20 deep test imports behind a
   per-plugin `testkit/`. Compiler enforcement for the boundary you care most about.
2. Stand up a jsdom vitest project in `client-core` and test the seven contribution hosts. This is the
   only finding that is getting worse on its own.
3. Fix the three flaky tests and land the five golden updates with the rail-marker work, so a red suite
   means something again.
4. Add the `c.req.json()` without `safeParse` rule to `tools/arch`, then fix the 10 files it flags.
   Start with `github/prActions.ts`.
5. Publish the one-page contribution-kind table, and treat the count as a number you watch.
6. Grow `@acorn/plugin-api/testkit` against the 141 imports that name what is missing.

Items 1 through 4 are mechanical and each is under a day. Items 5 and 6 are the ones that decide
whether a stranger can write a plugin.
