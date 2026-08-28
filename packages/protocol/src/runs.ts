import { z } from 'zod'

// The unified run list (docs/future/phased-review-steps/phase-4-node-autonomy.md 4.4).
//
// Three parts of the system model "a thing that started, took time, cost money, and ended" —
// `workflow_runs`, agent sessions, `schedule_runs` — in three SQLite files, one per owner, so nothing
// could list them together. This is the read model that can, and it is deliberately a registry rather
// than a table: a plugin declares the route that lists its runs and the host merges the answers, the
// same shape `ctx.collections` already uses for panels.
//
// **When to build the core table instead.** Written down so it is recognized rather than re-argued:
// when something *outside* the owning plugin must cancel a run, or charge it against a budget shared
// with another plugin's runs. Both need a row a stranger can write to and a lock a stranger can take,
// and neither is expressible as a merged read. Until then, no table and no migration. The cross-plugin
// resource governor (2026-08-27 extensibility review, finding 11) belongs beside that table when it
// arrives, modeled on `ProviderRequestScheduler`'s two-level shape — never before this registry has
// proved the vocabulary.

/** Five states, which is as many as a merged list can mean across owners. An owner with a richer
 *  vocabulary (an agent session has eleven) maps into this and keeps its own for its own surfaces.
 *  `waiting` is blocked on a person or a gate; `running` is spending. */
export const RUN_STATUSES = ['running', 'waiting', 'done', 'failed', 'cancelled'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const isTerminalRunStatus = (status: RunStatus): boolean =>
  status === 'done' || status === 'failed' || status === 'cancelled'

// Display-shaped, and no wider. A run row is what a person or an agent reads to answer "what is
// happening on this node"; anything more belongs on the owner's own surface, addressed by `id`.
const runRow = z.object({
  /** Unique within the owning plugin. The host qualifies nothing: `pluginId` beside it is the
   *  namespace, and a caller addressing the run goes back to that plugin's own routes. */
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  status: z.enum(RUN_STATUSES),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable().optional(),
  /** The task this ran for, when there is one. A schedule's run has none. */
  taskId: z.string().max(128).nullable().optional(),
  /** What it cost, when the owner knows. The reason a unified list is worth having at all: an agent
   *  loop and a workflow run both spend, and no surface could add them up. */
  costUsd: z.number().nonnegative().nullable().optional(),
  /** One line for the row, the owner's words. Not a status: a failed run's reason, a running one's
   *  current step. */
  detail: z.string().max(200).optional(),
})

/** What a plugin's `runs` route answers with. Parsed at the boundary like every other plugin answer;
 *  the host stamps provenance and a row never names its own source. */
export const runsResponseSchema = z.object({ runs: z.array(runRow).max(200) })

/** One row as its owner writes it — no `pluginId`, because a row never names its own source. This is
 *  the type a plugin's `runs` route returns. */
export type RunRowInput = z.infer<typeof runRow>

export type RunRow = RunRowInput & {
  /** Stamped by the host from the source that answered, never read off the response. */
  pluginId: string
}

export type RunsResponse = { runs: RunRow[] }

export const coreRunsRoute = '/v2/core/runs'
export const runsKey = ['runs'] as const
