// Run targets over the active task's worktree. Was the `window.acorn.terminal.run` preload bridge;
// now the loopback RunBridge routes shared with the MCP run tools. Run needs the main-
// process session engine, so it 503s in dev:node (a desktop-only surface — docs/electron.md §12).
import { runDefaultUrlRoute, runStartRoute, runStatusRoute, runStopRoute, runTargetsRoute } from '../../../core/shared/api'
import { readJson, writeJson } from '../../../core/client/apiClient'
import type { RunStatus, RunTargetInfo } from '../../../core/shared/terminal'
import { ApiError } from '../../../core/client/apiClient'
import { openRepoConfigTrust } from '../../../core/client/configTrust/configTrust'

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
