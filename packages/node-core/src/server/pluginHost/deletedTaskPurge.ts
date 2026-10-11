import type { NodePluginContext } from './types.ts'

// The two places a plugin purges its rows for deleted tasks (docs/workspaces-and-tasks/archive.md §
// Deleting a task): core's `core:task-deleted` hook, for a prompt purge, and a daily read of every
// tombstone, for a hook this plugin missed while disabled, slow, or restarting. One helper, so every
// plugin that stores task data wires both the same way and writes only `purge`.
//
// `purge` must be idempotent. The daily run hands it every task ever deleted, and almost all of them
// will already be gone. It answers how many rows it removed.

// Ids per `purge` call, under SQLite's bound-parameter limit with room to spare.
const PURGE_CHUNK = 500

export function registerDeletedTaskPurge(
  ctx: Pick<NodePluginContext, 'hooks' | 'schedules' | 'core'>,
  purge: (taskIds: readonly string[], signal: AbortSignal) => Promise<number>,
  options: { timeout?: number } = {},
): void {
  const purgeAll = async (taskIds: readonly string[], signal: AbortSignal) => {
    let removed = 0
    for (let start = 0; start < taskIds.length && !signal.aborted; start += PURGE_CHUNK) {
      removed += await purge(taskIds.slice(start, start + PURGE_CHUNK), signal)
    }
    return removed
  }
  ctx.hooks.handle('core:task-deleted', {
    id: 'purge-deleted-tasks',
    mode: 'observe',
    // The hook's own timeout only marks the run slow. The purge carries on, and the daily run finishes
    // anything it leaves.
    run: async (payload) => {
      await purgeAll(payload.taskIds as string[], new AbortController().signal)
    },
  })
  ctx.schedules.register({
    scheduleId: 'deleted-task-purge',
    name: 'Remove the data of deleted tasks',
    cadence: { daily: '04:10' },
    ...(options.timeout ? { timeout: options.timeout } : {}),
    run: async (signal) => {
      const removed = await purgeAll(await ctx.core.tasks.deleted(), signal)
      return removed ? `removed ${removed} rows` : undefined
    },
  })
}
