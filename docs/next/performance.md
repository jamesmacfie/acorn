# Future performance work

**Status:** forward-looking constraints and measurement triggers · **Current behavior:**
[caching.md](../caching.md), [diff-rendering.md](../diff-rendering.md),
[electron.md](../electron.md), and [state.md](../state.md)

The implemented architecture already centralizes cache policy, startup ordering, polling,
WebSocket output coalescing, and state restoration. Future performance work should be driven by
measurement rather than a framework or speculative rewrite.

## Keep the existing budgets visible

- Boot emits `[boot] <label> +Nms` marks for migration, service installation, listener readiness,
  first window, reconciliation, and teardown. Compare those marks before and after startup changes.
- PTY output is coalesced to roughly one renderer frame; do not regress to one UI update per chunk.
- Persisted TanStack data remains bounded and excludes patch/file bodies that can be reconstructed
  from the loopback server and blob cache.
- Provider resources retain explicit TTL, page, concurrency, serialized-size, context, and backoff
  budgets.
- Diff rendering keeps tokenization cutoffs, idle hydration, stable row identity, and separate
  unified/split virtualizers.

## Work to schedule when evidence appears

1. Add a repeatable cold/warm startup capture if boot marks show drift or startup work grows beyond
   what log comparison can explain.
2. Add a retention sweep for derived mirror rows, provider cache entries, completed workflow data,
   and other usage-proportional local state before long-lived databases become a support problem.
3. Revisit exact Postgres row counts, fixed search/result caps, and unbounded in-memory scheduler
   maps only when real repositories or tables hit those ceilings.
4. Promote visible-only poll scheduling into a shared budgeted scheduler if future plugins create
   enough independent pollers to contend.
5. Add targeted large-diff benchmarks before changing `DiffView` decomposition, highlighting, or
   virtualizer ownership. A component split must not reparse patches, retokenize rows, or rebuild
   split bands merely because parent props changed.

## Non-goals

No benchmark CI, telemetry service, or generalized performance framework is justified today.
Measurements should stay local and privacy-safe unless a concrete regression requires a broader
tool. Preserve behavior first; optimize the measured path second.
