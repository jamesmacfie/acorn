# WP-07 — Core stops owning plugin-shaped data (F8 remainder)

**Effort:** M · **Depends on:** run sequentially with WP-08 (both live in `packages/node-core`),
either order. WP-02 slices 5 (notes) first is helpful.

## Context — finding 8, docs/analysis.md

Finding 8: core owns data and policy that is shaped like specific plugins. Part of it has already
drained — `packages/node-core/src/server/sync/policy.ts` opens by saying the per-provider staleness
TTLs are gone. The verified remainder at pin time:

1. **`packages/node-core/src/server/db/cascade.ts`** — core carries per-plugin cascade knowledge
   (which plugin rows die when a core row dies). Cross-plugin data rules say plugin DBs are
   separate files with no cross-file FKs, so cascade is manual — but the *list* of what cascades is
   plugin knowledge sitting in core.
2. **Issues tables** (`issues` / `issueResources` in core's schema) — plugin-shaped (provider
   issues) data in core's DB. Check `packages/node-core/src/server/db/schema.ts` for the tables and
   trace consumers before deciding: this may be a deliberate shared read-model. If it is, the fix
   is documentation, not a move.
3. **`packages/node-core/src/server/agentTools/contextSections.ts`** — hardcoded `SECTION_ORDER`
   and a dual-shape `TaskContext` with `budgetLegacy()` — core knows every plugin's context
   sections and keeps a legacy shape alive.
4. **Notes-under-memory namespace inversion** — `plugins/notes/src/shared/api.ts:15-16` targets
   `/v2/p/memory/tasks/:id/notes`; the routes are served by
   `plugins/memory/src/server/routes/knowledge.ts:113-135` via `knowledgeBridgeSlot`. Notes' wire
   surface is owned by a different plugin (`docs/analysis.md:290`; undocumented in
   `docs/notes-and-memory.md` / `docs/api-reference.md`).

## Pre-flight

```sh
sed -n '1,30p' packages/node-core/src/server/db/cascade.ts
grep -n 'issues\|issueResources' packages/node-core/src/server/db/schema.ts
sed -n '1,40p' packages/node-core/src/server/agentTools/contextSections.ts
grep -n 'budgetLegacy\|SECTION_ORDER' -r packages/node-core/src plugins --include='*.ts' | grep -v '\.test\.'
grep -rn '/v2/p/memory' plugins/notes/src plugins/memory/src --include='*.ts' | grep -v '\.test\.'
```

For each of the four surfaces, confirm it still exists as described; amend this doc if drained.

## End state

- Cascade participation is declared by each plugin (natural seam: the plugin's server registration,
  next to where it registers routes/migrations) and core executes the declarations; `cascade.ts`
  keeps the executor, loses the plugin list.
- Issues tables: either moved to their owning plugin's DB, or **documented as a deliberate shared
  read-model** in `docs/data-layer.md` with the reasoning — a recorded decision is an acceptable
  outcome; silent ownership is not.
- `SECTION_ORDER` replaced by the `order` field contributions already carry (registries sort on
  declared order everywhere else); `budgetLegacy()` and the dual `TaskContext` shape collapsed to
  one shape — find who still produces/consumes the legacy shape first.
- Notes routes served under notes' own namespace (`/v2/p/notes/...`). The client and server ship
  together (same app), but task-scoped agents and the public automation API may hold URLs — keep a
  thin compatibility alias under `/v2/p/memory/...` for one release and mark it deprecated in
  `docs/api-reference.md`, unless pre-flight shows nothing external can hold a notes URL (then cut
  clean and say so).

## Non-goals

- No event-bus or subscribe mechanism (`ctx.events` is broadcast-only by decision — see
  `docs/plugins.md`).
- No changes to the one-DB-per-plugin rule, blob store, or retention model.
- No WP-08 territory (bridge slots as a *mechanism* — `knowledgeBridgeSlot` usage here changes only
  as far as the route move requires; unifying slot mechanisms is WP-08's).

## Slices (one commit each)

1. **Cascade declarations.** Contribution shape + executor change in `cascade.ts`; migrate one
   plugin's cascade as proof; test that a fabricated plugin declaration cascades correctly.
2. **Remaining plugins' cascade declarations**; delete the central list.
3. **Issues tables decision.** Trace consumers, decide move-vs-document, execute. If moving:
   migration in the owning plugin's chain (per-plugin DBs have their own migration chains —
   `docs/data-layer.md`), data copy, cutover, drop from core schema — this may need to split into
   2–3 commits; keep each green.
4. **`contextSections.ts`:** contributions carry order; delete `SECTION_ORDER`.
5. **`budgetLegacy()` / dual TaskContext:** collapse to one shape; delete the legacy path.
6. **Notes namespace:** serve under `/v2/p/notes/...`, flip `plugins/notes/src/shared/api.ts`,
   compatibility alias per End state, document in `docs/api-reference.md` +
   `docs/notes-and-memory.md`.

## Gates

Per slice: `pnpm --filter @acorn/node-core test` plus the touched plugin's suite. Slices 3 and 6:
`pnpm --filter @acorn/node test` (the integration suite exercises `createApp()` routes and DB
lifecycles). Package end: `pnpm --filter @acorn/arch-tests test`.

## Risks & rollback

- **Slice 3 is the only data migration in the whole program** — it alone gets a rollback plan
  (keep the core tables until the release after cutover; the migration is additive-then-drop, two
  releases apart if the tables move).
- **Slice 6 breaks holders of old URLs** if the alias decision is wrong — the pre-flight consumer
  trace (MCP tools, public API, agent harness) is the control.
- Slices 1/2/4/5 are code moves with test cover; revert independently.

## Doc updates

`docs/data-layer.md` (cascade, issues decision), `docs/api-reference.md` +
`docs/notes-and-memory.md` (namespace), `docs/agent-tools.md` (context sections) — each with its
slice.

## Done criteria

- [ ] `cascade.ts` contains no plugin names.
- [ ] Issues-tables decision recorded (moved, or documented as deliberate).
- [ ] `SECTION_ORDER` and `budgetLegacy` gone; grep clean.
- [ ] Notes served under `/v2/p/notes`; alias decision recorded.
- [ ] Integration + arch suites green.

## Progress

- [ ] Slice 1 — cascade seam + first plugin
- [ ] Slice 2 — all plugins, central list deleted
- [ ] Slice 3 — issues tables decision
- [ ] Slice 4 — section order
- [ ] Slice 5 — legacy TaskContext
- [ ] Slice 6 — notes namespace
