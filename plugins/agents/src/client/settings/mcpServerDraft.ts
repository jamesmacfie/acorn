// The settings form's working copy of one server, and the two conversions it needs.
import type { AgentMcpServer, AgentMcpServerInput, AgentMcpTransport } from '../../shared/mcpServers'

/** `stored` marks a secret the node already holds. Left empty, it is kept. */
export type AgentMcpPairDraft = { name: string; value: string; secret: boolean; stored: boolean }

export type AgentMcpServerDraft = {
  /** Set when editing. A server's name is its identity in every session that switched it on, so an
   *  edit cannot change it. */
  existing: string | null
  name: string
  transport: AgentMcpTransport
  command: string
  /** One argument per line, so an argument may contain spaces without any quoting rules. */
  args: string
  url: string
  values: AgentMcpPairDraft[]
  enabled: boolean
}

export const blankAgentMcpServerDraft = (): AgentMcpServerDraft => ({
  existing: null,
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  values: [],
  enabled: true,
})

export const agentMcpServerDraft = (server: AgentMcpServer): AgentMcpServerDraft => ({
  existing: server.name,
  name: server.name,
  transport: server.transport,
  command: server.command ?? '',
  args: server.args.join('\n'),
  url: server.url ?? '',
  values: server.values.map((pair) => ({
    name: pair.name,
    value: pair.value ?? '',
    secret: pair.secret,
    stored: pair.secret,
  })),
  enabled: server.enabled,
})

export function agentMcpServerInput(draft: AgentMcpServerDraft): AgentMcpServerInput {
  const values = draft.values
    .filter((pair) => pair.name.trim())
    .map((pair) => (pair.secret && pair.stored && pair.value === ''
      ? { name: pair.name.trim(), secret: true }
      : { name: pair.name.trim(), value: pair.value, secret: pair.secret }))
  return draft.transport === 'stdio'
    ? {
      transport: 'stdio',
      command: draft.command.trim(),
      args: draft.args.split('\n').map((arg) => arg.trim()).filter(Boolean),
      values,
      enabled: draft.enabled,
    }
    : { transport: 'http', url: draft.url.trim(), values, enabled: draft.enabled }
}
