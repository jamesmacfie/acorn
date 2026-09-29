// MCP config inspector (docs/mcp.md § Configuration) over loopback HTTP: was `window.acorn.mcp`. Reads
// the known candidate files in a project's folder and the home directory, parsed and secret-masked on
// the node.
import { projectMcpRoute, projectMcpStarterRoute, type ProjectMcpFile } from '@acorn/protocol/api.ts'
import { readJson, writeJson } from '../../infra/node/apiClient'

export const mcpApi = {
  inspect: (projectId: string) => readJson<ProjectMcpFile[]>(projectMcpRoute(projectId)),
  createStarter: (projectId: string) => writeJson<{ ok: boolean; reason?: string }>(projectMcpStarterRoute(projectId), { method: 'POST' }),
}
