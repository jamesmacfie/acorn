# WP-08 — One late-binding mechanism (F6) + node-side baseline drain

**Effort:** L (largest package) · **Depends on:** run sequentially with WP-07 (both in
`packages/node-core`), either order. WP-09 waits on this.

## Context — finding 6, docs/analysis.md

Three parallel mechanisms let node-side code bind to things that register later:

1. **The capability registry** (`packages/node-core/src/server/plugin/capabilities.ts`) — the
   documented seam (`docs/plugins.md` § Collaboration): typed, resolved at call time, per-runtime.
   This is the survivor.
2. **Module-global bridge slots** — `packages/node-core/src/server/bridge.ts` exports
   `bridgeSlot<B>()` / `viaBridge(...)`; its own header comment admits core's version "is pure
   indirection" and notes `configTrustBridgeSlot` was deleted for exactly that reason. Known users
   at pin time: `server/routes/worktree.ts`, `server/routes/plugins.ts`,
   `plugins/memory/src/server/routes/knowledge.ts` (`knowledgeBridgeSlot`) — enumerate the rest in
   pre-flight. The analysis also counts setter-style globals (e.g. an `onTaskCreated` /
   `onWorktreeCreated` hook, `main/wsHub.ts` handler registration, `main/activeIdentity.ts`) —
   these are the same disease in different clothes.
3. **`apps/node/src/wiring/`** — `agentToolsWiring.ts` (102 lines) and `agentProfiles.ts` (12
   lines): composition-root glue that survived from before the capability seam existed.

Also absorbed here, because they are the same problem (a plugin `main/` module reaching into core
guts instead of receiving its context), the two shrink-only baselines in
`tools/arch/boundaries.test.ts`:

- **`BROADCAST_BASELINE` (:352), 5 files** deep-importing `main/wsHub.ts`/`main/notify.ts`:
  `plugins/changes/src/main/localGit.ts`, `plugins/docker/src/main/dockerService.ts`,
  `plugins/memory/src/main/knowledgeIpc.ts`, `plugins/terminal/src/main/agentTools.ts`,
  `plugins/terminal/src/main/terminal.ts`. Fix shape: thread the plugin's broadcast capability
  through its activation context instead of deep-importing the hub.
- **`APP_DEEP_IMPORT_BASELINE` (:381), 7 entries** of apps deep-importing plugin internals:
  `@acorn/plugin-notes/main/seedTaskNotes.ts`, `@acorn/plugin-onboarding/client/index.tsx`,
  `@acorn/plugin-preview/main/{browserService,previewService}.ts`,
  `@acorn/plugin-agents/main/profiles/index.ts`,
  `@acorn/plugin-terminal/main/{pickerIpc,terminal}.ts`. Fix shape per entry: promote to a plugin
  entrypoint/contract export, or invert into a registration the plugin makes itself. This baseline
  has already shrunk twice — follow the pattern of those prior shrinks (see the comments around
  :381).

## Pre-flight

```sh
grep -rn 'bridgeSlot\|BridgeSlot' packages plugins apps --include='*.ts' | grep -v '\.test\.'
grep -rn 'let on[A-Z]\|export function set[A-Z]' packages/node-core/src --include='*.ts' | grep -v '\.test\.'
ls apps/node/src/wiring/
sed -n '340,400p' tools/arch/boundaries.test.ts
sed -n '1,60p' packages/node-core/src/server/plugin/capabilities.ts
```

Build the definitive inventory: every slot, setter-global, and wiring file, with its registrar and
its consumer. Commit the inventory as an amendment to this doc.

## End state

- One late-binding mechanism: the capability registry. `bridge.ts` deleted or reduced to a typed
  shim over capabilities (prefer deletion; its header already argues for it).
- `apps/node/src/wiring/` gone — its glue becomes plugin registrations or capability provisions.
- `BROADCAST_BASELINE = []` and `APP_DEEP_IMPORT_BASELINE = []`; arrays emptied entry-by-entry, in
  the same commits as the fixes.
- The capability registry's failure semantics preserved exactly: resolved at call time, fails
  closed when unbound — do not add eager resolution or default fallbacks while migrating.

## Non-goals

- No DI container, no lifecycle framework — `docs/plugins.md` explicitly says the registry is not
  a DI container; keep it that way.
- No event-bus / subscribe side for `ctx.events` (decided against; broadcast-only).
- No composition-root dedup (WP-09 — after this).
- `CHILD_PROCESS_OK` and `CORE_IMPORT_ROOTS` are allowlists, not debt — untouched.

## Slices (one commit each)

1. **Inventory** (pre-flight output, appended to this doc): each slot/setter/wiring with registrar,
   consumer, and the capability it should become.
2..N. **One slot or one baseline entry per commit**, mechanical rhythm:
   define/extend the capability → registrar provides it → consumer resolves it → delete the
   slot/deep-import → shrink the baseline array (if applicable) → package tests green.
   Suggested order: start with a leaf slot with one consumer (proves the rhythm cheaply), then the
   5 broadcast files, then the 7 deep-import entries, then the remaining core slots
   (`worktree.ts`, `plugins.ts`, `wsHub` handlers, `activeIdentity` — the latter must respect the
   "only core touches `ACTIVE_IDENTITY`" boundary rule), and `apps/node/src/wiring/` last since
   the wiring dissolves once the capabilities exist.
Final. **Delete `bridge.ts`** (or record precisely what justified keeping a shim).

## Gates

Per slice: `pnpm --filter @acorn/node-core test`, the touched plugin's suite, and
`pnpm --filter @acorn/arch-tests test` (the baseline arrays are asserted with `toEqual`, so a
shrink that misses the array edit fails loudly — that is the point). After wiring deletion:
`pnpm --filter @acorn/node test` (integration suite boots the real composition root) and desktop
e2e once at package end (terminal + agents surfaces are exercised there).

## Risks & rollback

- **Boot-order:** slots tolerate registration-after-import differently than capabilities; a
  consumer that fires during activation may resolve before the provider registered. The two-phase
  lifecycle (`init` registers, `activate` has side effects — `docs/plugins.md`) is the rule that
  makes this safe: providers must register in `init`.
- **Terminal PTY paths** (`terminal.ts` in both baselines) are the riskiest consumers — live PTY
  behavior is only partially testable (known-red `posix_spawnp` test); do terminal entries late,
  after the rhythm is proven, and write a user QA note for terminal flows.
- Every slice is one seam and reverts alone; the baselines can only shrink, so a botched revert
  shows up as an arch-test failure, not silent drift.

## Doc updates

`docs/plugins.md` § Collaboration (bridge slots removed from the story; capability registry the
single mechanism) — with the final slice. `docs/terminal-and-agents.md` if terminal wiring
changes shape.

## Done criteria

- [ ] Inventory appended; every row resolved.
- [ ] `BROADCAST_BASELINE` and `APP_DEEP_IMPORT_BASELINE` both `[]`.
- [ ] `apps/node/src/wiring/` deleted; `bridge.ts` deleted or justified.
- [ ] node-core + integration + arch suites green; user QA note for terminal flows.

## Progress

- [ ] Slice 1 — inventory
- [ ] Broadcast entries 1–5
- [ ] Deep-import entries 1–7
- [ ] Core slots + wiring
- [ ] Final — bridge.ts
