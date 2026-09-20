import { describe, expect, it } from 'vitest'
import { queryContentSchema } from './dataQueries'
import { resolveDataBinding, resolveQueryContent, resolveQueryParameters } from './dataQueryResolution'

describe('query binding resolution', () => {
  it('preserves nested whole records, boolean values, and explicit null', () => {
    const context = { inputs: { record: { labels: ['a'], enabled: false, owner: null } } }
    expect(resolveDataBinding({ address: { from: 'input', name: 'record', pointer: '' } }, context)).toEqual(context.inputs.record)
    expect(resolveDataBinding({ address: { from: 'input', name: 'record', pointer: '/owner' }, fallback: 'unknown' }, context)).toBeNull()
    expect(resolveDataBinding({ address: { from: 'item', pointer: '/enabled' } }, { item: context.inputs.record })).toBe(false)
  })
  it('uses explicit fallbacks and conversions without granting undeclared context', () => {
    expect(() => resolveDataBinding({ address: { from: 'step', stepId: 'sibling', pointer: '' } }, {})).toThrow('missing')
    expect(resolveDataBinding({ address: { from: 'input', name: 'absent', pointer: '' }, fallback: 0 }, {})).toBe(0)
    expect(resolveDataBinding({ address: { from: 'literal', value: 4 }, conversion: 'scalar-to-text' }, {})).toBe('4')
    expect(() => resolveDataBinding({ address: { from: 'literal', value: {} }, conversion: 'scalar-to-text' }, {})).toThrow('primitive')
    expect(() => resolveDataBinding({ address: { from: 'input', name: 'record', pointer: '/__proto__' } }, {})).toThrow()
  })
  it('resolves only declared typed parameters and distinguishes literal objects from bindings', () => {
    const content = queryContentSchema.parse({
      name: 'Typed query',
      parameters: { type: 'object', properties: { connection: { type: 'string' }, count: { type: 'number' } }, required: ['connection', 'count'], additionalProperties: false },
      connection: { address: { from: 'input', name: 'connection', pointer: '' } },
      sourceParameters: { limit: { address: { from: 'input', name: 'count', pointer: '' } } },
      query: { source: { pluginId: 'fixture', sourceId: 'items' }, scope: { workspaceId: 'workspace', parameters: { payload: { address: 'ordinary data' } } } },
    })
    const parameters = resolveQueryParameters(content, {
      connection: { address: { from: 'literal', value: 'account-1' } },
      count: { address: { from: 'step', stepId: 'previous', pointer: '/count' } },
    }, { steps: { previous: { count: 3 } } })
    expect(resolveQueryContent(content, parameters).scope).toEqual({ workspaceId: 'workspace', connectionId: 'account-1', parameters: { payload: { address: 'ordinary data' }, limit: 3 } })
    expect(() => resolveQueryContent(content, { ...parameters, count: '3' })).toThrow()
    expect(() => resolveQueryContent(content, { ...parameters, extra: true })).toThrow()
  })
})
