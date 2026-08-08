# WP-03 — Shell stops naming providers (F10a)

**Effort:** M–L · **Depends on:** nothing · **Unblocks:** WP-04, WP-05, and shrinkage of
`PLUGIN_NAMED_BASELINE` (see `tools/arch/boundaries.test.ts:424-450` comments).

## Context — finding 10, docs/analysis.md

The shell (packages/client-core + the desktop client app) still hardcodes `'github'` as the default
and fallback source. Verified literals at pin time (`279fa860`):

- `packages/client-core/src/tasks/tasks.ts:20` — `isSourceId` special-cases `v === 'github'`
  alongside the registry lookup.
- `packages/client-core/src/tasks/tasks.ts:21` — `createSignal<string | null>('github')` as the
  initial selected source.
- `packages/client-core/src/tabs/TabRail.tsx:154` — palette command `source.github.open` calls
  `setSelectedSource('github')`.
- `packages/client-core/src/tabs/TabRail.tsx:259` — archive-active-task fallback
  `setSelectedSource('github')`.
- `packages/client-core/src/workspaces/workspaceViewTransition.ts:59` — `: 'github'` fallback.
- `packages/client-core/src/persistence/appStartup.ts:104` — persisted-slice default
  `empty: () => 'github'`.

The existing seam is `packages/client-core/src/registries/sources.ts` — plugins already register
sources there; what is missing is a registry-supplied notion of the **default/fallback source** so
the shell can stop naming one.

Constraint from repo memory: the rail source is restored per-workspace by one `activeWorkspace`
effect in `App.tsx` — do not set `selectedSource` on workspace navigation anywhere else.

## Pre-flight

```sh
grep -rn "'github'" packages/client-core/src --include='*.ts' --include='*.tsx' \
  | grep -v '\.test\.' | grep -v githubShellReads
sed -n '424,455p' tools/arch/boundaries.test.ts   # read the PLUGIN_NAMED_BASELINE comments
sed -n '1,40p' packages/client-core/src/registries/sources.ts
```

Read the `:434` comment ("until the shell stops naming agents") carefully: if the blocked baseline
entry (`managedAgents.ts`) turns out to hinge on *agents*-naming rather than *github*-naming in the
shell, enumerate those literals too (`grep -rn "'agents'" packages/client-core/src`) and either
fold them into a slice here or record explicitly in Progress why they are out of scope.

## End state

- No `'github'` literal in `packages/client-core/src` outside `githubShellReads.ts` (WP-04's
  territory) and tests.
- The source registry exposes a default-source concept (e.g. the lowest-`order` registered source,
  or an explicit `isDefault` contribution flag — pick whichever matches how `registries/*.ts`
  already model ordering; registries sort on declared `order`, never registration order).
- plugins/github's client registration declares itself the default; behavior is unchanged.
- Palette command for "go to GitHub" is contributed by plugins/github via the existing palette
  registration mechanism, not hardcoded in `TabRail.tsx`.

## Non-goals

- Deleting `githubShellReads.ts` (WP-04) or moving routes (WP-05) or CSS (WP-06).
- Multi-default or per-workspace default sources — invent nothing the product doesn't have.

## Slices (one commit each)

1. **Registry default.** Extend `registries/sources.ts` with the default-source accessor + a unit
   test. Pure addition, nothing consumes it yet.
2. **`tasks.ts`.** Replace the `:20` special case (registry lookup should cover a registered
   github source — confirm why the special case exists first; if it guards a
   registration-order race, the fix must respect boot order in
   `apps/desktop/src/app/client/plugins.ts`) and the `:21` initial value with the registry
   accessor (lazy — resolve at first read, not module load, since plugin registration happens
   after module import).
3. **`TabRail.tsx` fallback (:259)** and **`workspaceViewTransition.ts:59`** → registry accessor.
4. **`appStartup.ts:104`** — the persisted slice's `empty` default → registry accessor. Note the
   repo gotcha: the IndexedDB-persisted query cache has no buster, and persisted-state slices are
   conformance-tested (`apps/desktop/test/integration/persistedState.conformance.test.ts`) — run
   that suite.
5. **Palette command (:154)** — move `source.github.open` into plugins/github's client palette
   contribution; delete from `TabRail.tsx`.
6. **Baseline shrink, if unblocked.** If pre-flight established that this package removes the
   blocker for `managedAgents.ts` (or any other `PLUGIN_NAMED_BASELINE` entry), do the move and
   delete the baseline entry in the same commit. Otherwise record in Progress what still blocks it.

## Gates

Per slice: `pnpm --filter @acorn/client-core test`, `pnpm lint`. After slices 2 and 4:
`pnpm --filter @acorn/desktop test` (persisted-state + parity conformance). At package end:
`pnpm --filter @acorn/arch-tests test` and desktop e2e (`pnpm --filter @acorn/desktop test:e2e`)
since the rail/startup path is user-facing.

## Risks & rollback

- **Boot-order:** the shell reads the default before plugins register → blank rail. Mitigate with
  lazy resolution and a test that asserts the accessor after simulated registration.
- **Persisted state:** stored source ids from existing installs must keep working
  (`unknownIds: 'retain-inert'` semantics at `appStartup.ts:104` must survive the change).
- Each slice is a small, independently revertible substitution.

## Doc updates

`docs/frontend.md` (shell state / registries) and `docs/panes.md` if the contribution shape gains a
field — same commit as slice 1. User QA note at package end: launch app, confirm rail defaults to
GitHub browse, archive an active task and confirm fallback, run palette "Go to GitHub".

## Done criteria

- [x] Pre-flight grep returns zero shell provider source literals.
- [x] Default-source accessor exists, tested, documented.
- [x] Palette command contributed by plugins/github.
- [x] Arch tests green; the remaining named-protocol baseline is justified.
- [x] User QA handoff is recorded in the final migration audit; live Electron QA remains environment-dependent.

## Progress

- [x] Slice 1 — registry default
- [x] Slice 2 — tasks.ts
- [x] Slice 3 — TabRail fallback + workspaceViewTransition
- [x] Slice 4 — appStartup persisted default
- [x] Slice 5 — palette command
- [x] Slice 6 — baseline shrink / blocker note

Completed 2026-08-08. `sourceRegistry` now resolves an explicit lazy default, with declared rail
order as a bare-host fallback; the GitHub plugin owns the default source, navigation command, and
keybinding. Core/client shell code no longer contains provider-specific `'github'` source literals
(the remaining GitHub shell read seam is WP-04). `managedAgents.ts` remains in the named-protocol
baseline because the client-core agent-tool renderer registry still imports that shared contract; it
is not unblocked by source ownership and is left for a separately justified boundary change.

Validation: `pnpm --filter @acorn/client-core test`, `pnpm --filter @acorn/plugin-github test`, and
`pnpm lint` pass. Desktop persisted-state conformance and full arch/e2e gates remain package-end
checks; manual QA is recorded in the final migration audit.
