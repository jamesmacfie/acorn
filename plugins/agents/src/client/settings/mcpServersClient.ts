import { readJson, writeJson } from '@acorn/plugin-api/client'
import {
  agentMcpServerRoute,
  agentMcpServersRoute,
  agentMcpServerTestRoute,
  type AgentMcpProbeResult,
  type AgentMcpServer,
  type AgentMcpServerInput,
} from '../../shared/mcpServers'

export const agentMcpServersQueryKey = ['agents', 'mcp-servers'] as const

export const agentMcpServersOptions = () => ({
  queryKey: agentMcpServersQueryKey,
  queryFn: ({ signal }: { signal?: AbortSignal }) => readJson<AgentMcpServer[]>(agentMcpServersRoute, { signal }),
})

export const saveAgentMcpServer = (name: string, input: AgentMcpServerInput) =>
  writeJson<AgentMcpServer>(
    agentMcpServerRoute(name),
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
    (response) => `MCP server save ${response.status}`,
  )

export const removeAgentMcpServer = (name: string) =>
  writeJson<{ ok: true }>(agentMcpServerRoute(name), { method: 'DELETE' }, (response) => `MCP server remove ${response.status}`)

// The node gives a server 30 seconds to answer, which is the broker's own default, so the request
// waits a little longer than that to hear the node's answer rather than the broker's.
export const testAgentMcpServer = (name: string) =>
  writeJson<AgentMcpProbeResult>(
    agentMcpServerTestRoute(name),
    { method: 'POST', timeoutMs: 45_000 },
    (response) => `MCP server test ${response.status}`,
  )
