import { createSignal } from 'solid-js'
import { Tabs, TabPanel } from '@acorn/plugin-api/ui'
import { McpConfigFiles } from '@acorn/plugin-api/ui/host'
import AgentMcpServersSettings from './AgentMcpServersSettings'

// Settings → Agents → MCP (docs/mcp.md § Configuration): the servers acorn adds to every session, and
// the servers each CLI loads from its own config files, as two tabs of one page. Both panels stay
// mounted while hidden, so a half-typed server survives a tab switch and a deep link to either tab's
// section finds it.
const TABS = [
  { id: 'servers', label: 'Servers' },
  { id: 'files', label: 'Config files' },
]
const ID_PREFIX = 'mcp-settings'

export default function McpSettingsPage() {
  const [tab, setTab] = createSignal('servers')
  return (
    <>
      <Tabs tabs={TABS} active={tab()} onChange={setTab} idPrefix={ID_PREFIX} ariaLabel="MCP settings" />
      <TabPanel idPrefix={ID_PREFIX} id="servers" active={tab()}><AgentMcpServersSettings /></TabPanel>
      <TabPanel idPrefix={ID_PREFIX} id="files" active={tab()}><McpConfigFiles /></TabPanel>
    </>
  )
}
