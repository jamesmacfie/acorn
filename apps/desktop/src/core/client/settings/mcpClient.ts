// MCP config inspector (docs/mcp.md) over loopback HTTP (Phase 3): was `window.acorn.mcp`. Reads
// the known candidate files, parsed + secret-masked in main. Backed by the terminal engine's
// worktree resolution, so it 503s in dev:node.
import { taskMcpRoute, taskMcpStarterRoute } from '../../shared/api'
import { readJson, writeJson } from '../apiClient'
import type { McpServerSummary } from '../../shared/mcp'

export const mcpApi = {
  inspect: (taskId: string) => readJson<{ file: string; servers: McpServerSummary[] }[]>(taskMcpRoute(taskId)),
  createStarter: (taskId: string) => writeJson<{ ok: boolean; reason?: string }>(taskMcpStarterRoute(taskId), { method: 'POST' }),
}
