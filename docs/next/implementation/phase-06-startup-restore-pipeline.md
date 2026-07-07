# Phase 6 — Startup restore pipeline

**Status:** planned · **Depends on:** Phase 5 event bus preferred · **Gated by:**
smoke S2 and restore performance baseline · **Primary docs:**
[state-and-policies](../state-and-policies.md) §5.1,
[inventories](../inventories.md) §3a and §3c, [performance](../performance.md)
§3.4.

## Goal

Replace distributed startup effects with an explicit ordered restore/persist
pipeline. Restore order becomes data, not effect timing, and plugin-owned
persisted state goes through descriptors and codecs.

## Architectural Context

Startup currently depends on several effects in `App.tsx`, deferred execution,
guards, and comments explaining race avoidance. Every new persisted slice edits
the shell. This phase extracts a core service:

```text
PersistedStateSlice descriptors
  -> restore by phase: workspace -> view -> panes
  -> emit boot:restored
  -> arm throttled persistence
  -> scoped eviction on lifecycle events
```

## Implementation Plan

1. Audit state tiers.

   Classify all pref keys in [inventories](../inventories.md) §3a against the
   tier table in [state-and-policies](../state-and-policies.md) §5.1. Include
   localStorage state such as collapsible PR sections, comment drafts, and
   settings component state. Record whether each becomes T3 or deliberately
   remains localStorage with a reason.

2. Add `PrefKeys`.

   Replace bare string pref keys at call sites.

3. Add descriptor registry.

   `PersistedStateSlice` includes key, scope, restore phase, version, codec,
   empty value, unknown-id handling, and optional max bytes. Persistence derives
   storage keys from scope ids, serializes through codecs, throttles writes, and
   refuses oversize payloads with a notice.

4. Add `createStartupRestore()`.

   It owns hydrate-then-persist, ordered phases, and persistence arming after
   `boot:restored`.

5. Unify prefs write-back.

   The optimistic `setQueryData` protocol wins. Add the missing failure notice
   path to `savePref`.

6. Persist less.

   Exclude file-body and patch queries from IndexedDB dehydration and add a
   persister throttle.

7. Port `App.tsx` slice by slice.

   Theme first, then workspace/repo/task/view/pane slices. Keep legacy
   `task_panes` fallback until a migration writes `task_layouts`.

8. Add scoped-state eviction.

   Subscribe to task archive and workspace removal events to clear keyed
   collections listed in [inventories](../inventories.md) §3c. Build container
   machinery only if hand-keyed collections keep multiplying.

## Slice Order

1. Tier audit table, `PrefKeys`, no-op descriptor registry.
2. Codec tests for `task_layouts`.
3. Theme slice.
4. Workspace/repo/task restore slices.
5. Pane layout slices.
6. Query persister exclusions/throttle.
7. Scoped eviction.
8. `App.tsx` cleanup.

## Acceptance Criteria

- `App.tsx` has no free-standing restore/persist effects.
- Restore phases are descriptor data.
- Persistence arms only after restore completes.
- Every T3 slice has a descriptor and codec.
- No feature writes raw JSON to prefs.
- Every pref key is a `PrefKeys` member.
- Failed pref writes surface as notices.
- File bodies and patches are not persisted into IndexedDB.
- Scoped keyed collections evict on archive/removal events.
- `rail_order` remains distinct from server-side `tasks.sort`.

## Verification

- `pnpm lint`
- `pnpm test`
- Smoke S2 before and after every slice PR.
- Manual relaunch matrix: last workspace, task, source, pane layout, editor
  tabs, weights, and pins restore; maximize does not.
- Kill-during-boot does not clobber prefs.
- IndexedDB restore time compared against baseline.
- Oversize persisted slice emits a notice and does not write corrupt state.

## References

- [review.md](../review.md) §4 and recommendation #9.
- [state-and-policies.md](../state-and-policies.md) §5.1.
- [inventories.md](../inventories.md) §3a and §3c.
- [performance.md](../performance.md) §3.4.
- [ui-state.md](../ui-state.md) §2.1.
- [feature-parity.md](../feature-parity.md) §2 and §4.
- [docs-overhaul.md](../docs-overhaul.md) §3 for `docs/state.md`.
