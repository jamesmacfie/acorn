# Phase 0: land what is in flight, make red mean something

Part of [phased-review-steps](./README.md). Everything else in this folder assumes a committed
baseline and a green suite. Neither exists on 2026-08-28: the reviews themselves are untracked,
a large batch of review fixes sits uncommitted in the working tree, and eight test tasks are red,
five of them waiting on that same uncommitted work. Until this phase lands, "the tests fail"
carries no information, and the consistency review's own closing warning applies: its
cross-references to the other reviews are worthless if the files exist on one machine.

## Work items

### 0.1 Commit the reviews and the plugin map

`docs/reviews/` (all five files), `docs/plugin-map.md`, and `docs/plugin-map.html` are untracked.
Commit them before acting on anything they say. The consistency review asks for exactly this, for
the reason above. No content changes; the reviews are point-in-time records and each already
carries an "Updated" annotation where later work moved its numbers.

### 0.2 Land the in-flight working tree

The uncommitted working tree holds two completed bodies of work:

- **The consistency-review batch.** All eight ordered items plus the smaller things, batched into
  one `PLUGIN_API_MAJOR` bump to 3 (`packages/protocol/src/pluginApiVersion.ts`). Visible in the
  tree as: `packages/client-core/src/registries/pollers.ts` deleted and `schedules.ts` added,
  `capabilities.ts` deleted and `hostCapabilities.ts` added, `contextSections.ts` renamed to
  `contextSectionSlots.ts`, `plugins/workflows/src/client/triggerPoller.ts` replaced by
  `triggerSchedule.ts`, and the regenerated `packages/plugin-api/src/surface.snapshot.txt`. The
  implementation note at the top of
  [the consistency review](../../reviews/2026-08-27-plugin-surface-consistency.md) records the two
  judgement calls (`ctx.log` deleted; `when` deliberately left non-uniform).
- **The rail-marker work** (slices 1 and 2 of [rail-tab.md](../rail-tab.md)), which five golden
  tests are waiting on.

Landing this batch resolves the five golden-list failures the architecture review names in
finding 6: `apps/node` `routeRegistry.test.ts` (177 to 184 routes), `apps/node`
`pluginDisable.test.ts` (27 to 28), `apps/desktop` `persistedState.conformance.test.ts` (4 to 5
slices), the `tools/arch` plugin-stylesheet survivor list, and `client-core` `ui/adoption.test.ts`.
Update each golden alongside the commit, not before and not after, so the history shows the tests
doing their job.

Check the documentation moved with it. The consistency review's "Documentation to update" section
lists the owning docs (`docs/plugins.md`, `docs/plugin-authoring.md`, `docs/plugin-map.*`,
`docs/frontend.md`, `docs/schedules.md`); most show as modified in the working tree already, so
this is a review step, not new writing.

### 0.3 Fix the three tests that fail for their own reasons

Architecture review, finding 6. These are test-quality bugs, and a suite that fails for its own
reasons trains people to ignore it:

- `plugins/http/src/server/send.test.ts` compares two paths that print identically after
  truncation, almost certainly `/tmp` against `/private/tmp` on macOS. Apply `realpathSync` to
  both sides.
- `plugins/agents/src/main/drivers/acpDriver.test.ts`, "starts a fresh provider session when the
  agent no longer has the stored one", expects one call and gets none. Diagnose; the memory note
  `acorn-known-agentsend-pty-test-failure` records the adjacent PTY failure as fixable, and this
  one has not been root-caused.
- `client-core` `ui/adoption.test.ts` fails because its `CONVERTED` list (line 217) still names
  `plugins/terminal/src/client/slotContribution.tsx`, which the rail-marker work deleted. Update
  the list entry to whichever file the contribution moved to, and confirm that file uses the
  UI-kit primitives the test checks for.

### 0.4 Fix the two documentation lies

Both are one line, both are wrong today, and both mislead the next builder:

- `docs/mcp.md` claims the agent tool surface includes workflow, database, and Docker operations.
  It does not; no registered tool touches any of the three, and the four `run_*` tools are
  terminal run targets. [orchestration.md](../orchestration.md) and the extensibility review
  (finding 11) have both flagged it. Rewrite the sentence to describe the registered tools.
- `plugins/github/src/server/routes/deviceAuth.ts:37` carries
  `ownerId(c) // owner-gated: only the owner may begin connecting an account`. The comment asserts
  a gate that does not exist (`ownerId` returns the principal's user id and gates nothing). Delete
  the comment in this phase; the real gate is phase 1 item 1.5. A comment asserting a missing gate
  is worse than no comment, because the next reader stops looking.

## Acceptance

- `git log` contains the five review files and the plugin map.
- `pnpm test` passes every task. It now carries `--continue`, so it reports every package instead of
  cancelling siblings on the first failure, and it keeps Turborepo's concurrency bound. Do not swap in
  a bare `turbo run test --continue`: without the bound, suites that spawn processes or mint
  certificates time out under the load while passing in isolation.
- `docs/mcp.md` describes only tools that exist, and `deviceAuth.ts` no longer claims a gate it
  does not have.

## Verify before building

- Run `git status` first. If the working tree no longer holds the consistency batch (someone
  committed or reverted it), item 0.2 changes shape; read the commit history for
  `packages/protocol/src/pluginApiVersion.ts` to find where it went.
- Re-run `pnpm test` and compare the failure list against finding 6 of
  [the architecture review](../../reviews/2026-08-27-architecture-review.md). Failures outside
  that list are new and belong to whatever caused them, not to this phase.
- Check the boot-trust snapshot before blaming a diff for e2e-shaped failures; the bundled rollbar
  plugin has previously wedged boots with a trust prompt.
