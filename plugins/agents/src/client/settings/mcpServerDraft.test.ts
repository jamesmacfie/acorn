import { describe, expect, it } from 'vitest'
import { agentMcpServerDraft, agentMcpServerInput } from './mcpServerDraft'

describe('the MCP server form', () => {
  const stored = {
    name: 'linear',
    transport: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@example/linear-mcp'],
    url: null,
    values: [
      { name: 'LINEAR_API_KEY', value: null, secret: true },
      { name: 'LOG_LEVEL', value: 'warn', secret: false },
    ],
    enabled: true,
    updatedAt: 1,
  }

  // The form never holds a stored secret, so an untouched one has to go back as "keep it" rather than
  // as an empty value, which would wipe it.
  it('keeps a stored secret the reader left empty and sends one they retyped', () => {
    const draft = agentMcpServerDraft(stored)
    expect(agentMcpServerInput(draft).values).toEqual([
      { name: 'LINEAR_API_KEY', secret: true },
      { name: 'LOG_LEVEL', value: 'warn', secret: false },
    ])
    draft.values[0]!.value = 'lin_new'
    expect(agentMcpServerInput(draft).values?.[0]).toEqual({ name: 'LINEAR_API_KEY', value: 'lin_new', secret: true })
  })

  it('reads one argument per line and drops blank rows', () => {
    const draft = agentMcpServerDraft(stored)
    draft.args = '-y\n\n  @example/linear-mcp  \n--flag with spaces'
    draft.values.push({ name: '  ', value: 'ignored', secret: false, stored: false })
    const input = agentMcpServerInput(draft)
    expect(input.args).toEqual(['-y', '@example/linear-mcp', '--flag with spaces'])
    expect(input.values).toHaveLength(2)
  })
})
