// Run targets over the active task's worktree. Was the `window.acorn.terminal.run` preload bridge;
// now the loopback RunBridge routes shared with the MCP run tools. Run needs the main-
// process session engine, so it 503s in dev:node (a desktop-only surface — docs/electron.md §12).
//
// CORE's, not the terminal plugin's, and that is what Phase 3 changed. Every route it calls is
// `/v2/core/tasks/:id/run*` (server/routes/harness.ts) — they moved to core in Phase 2's terminal
// scope-shed, because a run target is a property of the repo's config, not of a pseudo-terminal. The
// fetcher stayed behind in plugins/terminal/src/client/, which made `preview -> terminal` a coupling edge
// for a module that reaches nothing of terminal's.
//
// docs/vNext/plugins.md still says "terminal exports a `runTargets` capability". That design predates the
// scope-shed; a capability here would wrap core's own routes and add an indirection with no owner.
import { runDefaultUrlRoute, runStartRoute, runStatusRoute, runStopRoute, runTargetsRoute } from '@acorn/protocol/api.ts'
import type { RunStatus, RunTargetInfo } from '@acorn/protocol/terminal.ts'
import { ApiError, readJson, writeJson } from '../apiClient'
import { openRepoConfigTrust } from '../configTrust/configTrust'

export type RunLayout = { id: string; panes: string[]; terminal?: string; browser?: string }
export type RunTargetsResult =
  | { targets: RunTargetInfo[]; errors: { source: string; message: string }[]; layouts: RunLayout[] }
  | { error: string }

const post = <T>(url: string) => writeJson<T>(url, { method: 'POST' })

export const runApi = {
  targets: (taskId: string) => readJson<RunTargetsResult>(runTargetsRoute(taskId)),
  defaultUrl: (taskId: string) => readJson<{ url: string | null }>(runDefaultUrlRoute(taskId)).then((r) => r.url ?? undefined),
  start: async (taskId: string, targetId: string) => {
    const execute = () => post<{ ok: boolean; reason?: string; sessionId?: string }>(runStartRoute(taskId, targetId))
    try {
      return await execute()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'needs-trust') openRepoConfigTrust(taskId, execute)
      throw error
    }
  },
  stop: (taskId: string, targetId: string) => post<{ ok: boolean; reason?: string }>(runStopRoute(taskId, targetId)),
  status: (taskId: string, targetId: string) => readJson<RunStatus>(runStatusRoute(taskId, targetId)),
}
