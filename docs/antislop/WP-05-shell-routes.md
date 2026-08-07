# WP-05 — Provider-shaped routes become plugin-contributed (F10c)

**Effort:** M · **Depends on:** WP-03.

## Context — finding 10, docs/analysis.md

The desktop client's router hardcodes GitHub-PR-shaped paths:

- `apps/desktop/src/app/client/index.tsx:52-54` —
  `<Route path="/:owner/:repo" />`, `/:owner/:repo/new`, `/:owner/:repo/:number`.
- `apps/desktop/src/app/client/App.tsx:289-290` — `useMatch(() => '/:owner/:repo/new')` with a
  comment noting the static route deliberately outranks the `:number` param route.
- `packages/client-core/src/workspaces/fleetWorkspaces.ts:45` — comment: "The order is the whole
  point. Every route is `/:owner/:repo` with no node in it, and the shell derives…" — route order
  is load-bearing and covered by `fleetWorkspaces.test.ts`.

End goal of the finding: the shell owns the routing *scheme* (how routes compose, ordering rules);
a provider plugin contributes its own route shapes. Today only GitHub contributes URL shapes, so
this is a seam-creation package: the win is that adding a second provider's routes stops requiring
edits to `App.tsx`/`index.tsx`.

There is prior art for URL recognition living in the wrong place: `docs/analysis.md` finding 10
notes a Linear URL recogniser shipped inside plugins/github with a closed `InAppTarget` union —
locate it (`grep -rn 'InAppTarget' plugins packages`) and fold its ownership question into this
package.

## Pre-flight

```sh
sed -n '45,75p' apps/desktop/src/app/client/index.tsx
sed -n '280,300p' apps/desktop/src/app/client/App.tsx
sed -n '40,70p' packages/client-core/src/workspaces/fleetWorkspaces.ts
grep -rn 'InAppTarget' plugins packages --include='*.ts*' | grep -v '\.test\.'
grep -rn 'useMatch\|<Route' apps/desktop/src/app/client --include='*.tsx' | grep -v '\.test\.'
```

## End state

- Route shapes (`/:owner/:repo`, `/new`, `/:number`) declared by plugins/github through a client
  registry contribution (natural home: alongside `registries/sources.ts`, since a source and its
  route shapes belong together).
- The shell composes contributed routes preserving the documented ordering rule (static before
  param); the ordering rule itself is asserted by a test that does not name any provider.
- `fleetWorkspaces.ts` derives workspace routing from contributed shapes, not literals.
- Deep-link behavior identical: every URL that resolved before resolves to the same view after.

## Non-goals

- New URL schemes, provider-prefixed URLs, or any user-visible URL change — existing URLs are
  persisted in tabs/history and must keep resolving.
- Migrating the create-PR draft flow (`?base=&head=` params — repo memory: URL params win over the
  client-local draft; preserve exactly).

## Slices (one commit each)

1. **Characterize.** Add a routing test pinning today's resolution table (each URL shape → view,
   including the `/new`-outranks-`:number` rule) so later slices prove no behavior change.
2. **Contribution type.** Route-shape contribution in client-core registries + unit test; nothing
   consumes it yet.
3. **plugins/github declares its shapes.** Registration only, still unconsumed.
4. **Shell consumes.** `index.tsx` + `App.tsx` render contributed routes; delete the literals.
   Slice 1's test must pass unmodified.
5. **`fleetWorkspaces.ts`** derives from contributions; its existing order test keeps passing.
6. **InAppTarget ownership** (from pre-flight): if the Linear recogniser + closed union blocks
   another provider from contributing link targets, open the union via the same registry pattern;
   if it is a contained github-internal, record why it stays.

## Gates

Per slice: `pnpm --filter @acorn/client-core test`, `pnpm --filter @acorn/desktop test`,
`pnpm lint`. Package end: `pnpm --filter @acorn/arch-tests test` + desktop e2e (routing is core
UX; both e2e specs exercise navigation).

## Risks & rollback

- **Route order regression** is the failure mode — slice 1's pinned resolution table is the guard;
  do not weaken it to make a slice pass.
- **Startup restore:** per-workspace rail/source restore happens in one `activeWorkspace` effect in
  `App.tsx` (repo memory) — route composition must not re-trigger or reorder it.
- Slices 2–3 are additive; slice 4 is the single risky substitution and reverts alone.

## Doc updates

`docs/frontend.md` (routing/composition) and `docs/workspaces-and-tasks.md` if workspace route
derivation is described there — with slice 4/5. User QA note: open a PR URL directly, create-PR
flow via `/new`, workspace switch restores the right view.

## Done criteria

- [ ] No `:owner/:repo` literal in `apps/desktop/src/app/client` or `fleetWorkspaces.ts`.
- [ ] Resolution-table test from slice 1 unchanged and green.
- [ ] InAppTarget decision recorded (moved or justified).
- [ ] Arch tests + e2e green; user QA note written.

## Progress

- [ ] Slice 1 — pinned resolution table
- [ ] Slice 2 — contribution type
- [ ] Slice 3 — github declares shapes
- [ ] Slice 4 — shell consumes
- [ ] Slice 5 — fleetWorkspaces
- [ ] Slice 6 — InAppTarget decision
