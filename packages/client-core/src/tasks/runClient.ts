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
