import { McpConfigFiles } from '@acorn/plugin-api/ui/host'
import AgentMcpServersSettings from './AgentMcpServersSettings'

// Settings → Agents → MCP (docs/mcp.md § Configuration): the servers acorn adds to every session, and
// the servers each CLI loads from its own config files, as consecutive sections of one page.

export default function McpSettingsPage() {
  return (
    <>
      <AgentMcpServersSettings />
      <McpConfigFiles />
    </>
  )
}
