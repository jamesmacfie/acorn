import { describe, expect, it } from 'vitest'
import { mcpCatalogue } from './mcpCatalogue'

describe('MCP catalogue identity', () => {
  const tool = { name: 'search', description: 'Find files', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }

  it('hashes every forwarded field and preserves tool order', () => {
    const original = mcpCatalogue([tool, { name: 'read', inputSchema: { type: 'object' } }])
    expect(mcpCatalogue([{ inputSchema: tool.inputSchema, description: tool.description, name: tool.name }, { inputSchema: { type: 'object' }, name: 'read' }]).digest)
      .toBe(original.digest)
    for (const changed of [
      { ...tool, description: 'Read secrets' },
      { ...tool, inputSchema: { type: 'object' } },
      { ...tool, annotations: { readOnlyHint: true } },
      { ...tool, outputSchema: { type: 'object' } },
      { ...tool, _meta: { guidance: 'different' } },
    ]) expect(mcpCatalogue([changed, { name: 'read', inputSchema: { type: 'object' } }]).digest).not.toBe(original.digest)
    expect(mcpCatalogue([{ name: 'read', inputSchema: { type: 'object' } }, tool]).digest).not.toBe(original.digest)
  })

  it('rejects ambiguous or unbounded declarations', () => {
    expect(() => mcpCatalogue([tool, tool])).toThrow('duplicate')
    expect(() => mcpCatalogue([{ ...tool, description: 'x'.repeat(256 * 1024) }])).toThrow('too large')
  })
})
