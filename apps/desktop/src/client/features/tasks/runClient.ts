// Run targets over the active task's worktree. Was the `window.acorn.terminal.run` preload bridge;
// now the loopback RunBridge routes shared with the MCP run tools (Phase 3). Run needs the main-
// process session engine, so it 503s in dev:node (a desktop-only surface — capability map, §6).
import { runDefaultUrlRoute, runStartRoute, runStatusRoute, runStopRoute, runTargetsRoute } from '../../../shared/api'
import { readJson, writeJson } from '../../apiClient'
import type { RunStatus, RunTargetInfo } from '../../../shared/terminal'

export type RunLayout = { id: string; panes: string[]; terminal?: string; browser?: string }
export type RunTargetsResult =
  | { targets: RunTargetInfo[]; errors: { source: string; message: string }[]; layouts: RunLayout[] }
  | { error: string }

const post = <T>(url: string) => writeJson<T>(url, { method: 'POST' })

export const runApi = {
  targets: (taskId: string) => readJson<RunTargetsResult>(runTargetsRoute(taskId)),
  defaultUrl: (taskId: string) => readJson<{ url: string | null }>(runDefaultUrlRoute(taskId)).then((r) => r.url ?? undefined),
  start: (taskId: string, targetId: string) => post<{ ok: boolean; reason?: string; sessionId?: string }>(runStartRoute(taskId, targetId)),
  stop: (taskId: string, targetId: string) => post<{ ok: boolean; reason?: string }>(runStopRoute(taskId, targetId)),
  status: (taskId: string, targetId: string) => readJson<RunStatus>(runStatusRoute(taskId, targetId)),
}
