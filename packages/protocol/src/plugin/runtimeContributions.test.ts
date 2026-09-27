import { describe, expect, it } from 'vitest'
import { ACORN_BASELINE } from '../baseline.ts'
import { PLUGIN_API_MAJOR } from './apiVersion.ts'
import { pluginManifestShape } from './contract.ts'
import {
  boundedPluginToolSchema,
  PLUGIN_TOOL_SCHEMA_MAX_BYTES,
  pluginAgentToolDescriptorSchema,
  pluginContextSectionDescriptorSchema,
} from './runtimeContributions.ts'

const inputSchema = {
  type: 'object',
  properties: { query: { type: 'string', minLength: 1 } },
  required: ['query'],
  additionalProperties: false,
}

describe('manifest runtime contributions', () => {
  it('parses tool and context descriptors through the manifest with their runtime defaults', () => {
    const manifest = pluginManifestShape.parse({
      id: 'search', name: 'Search', version: '1.0.0', baseline: ACORN_BASELINE,
      apiVersion: PLUGIN_API_MAJOR,
      contributions: {
        agentTools: [{
          id: 'find_tasks', description: 'Find matching tasks', risk: 'read',
          inputSchema, handler: '/v1/p/search/find',
        }],
        contextSections: [{
          id: 'related_tasks', label: 'Related tasks', order: 10,
          read: '/v1/p/search/context', maxBytes: 4_096, maxTokens: 1_024,
        }],
      },
    })

    expect(manifest.contributions.agentTools[0]).toMatchObject({
      scope: 'task', requiresSession: false, timeoutMs: 10_000, maxOutputBytes: 65_536,
    })
    expect(manifest.contributions.contextSections[0]).toMatchObject({
      scope: 'task', defaultIncluded: false, timeoutMs: 5_000,
    })
  })

  it('rejects unsupported and inconsistent nested JSON Schema fields at their paths', () => {
    const result = boundedPluginToolSchema.safeParse({
      type: 'object',
      properties: { query: { type: 'string', pattern: '[a-z]', minLength: 5, maxLength: 2 } },
      required: ['missing'],
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map(({ path }) => path.join('.'))).toEqual(expect.arrayContaining([
      'properties.query.pattern', 'properties.query', 'required',
    ]))
  })

  it('rejects deeply nested and oversized tool schemas', () => {
    let nested: unknown = { type: 'string' }
    for (let i = 0; i < 9; i++) nested = { type: 'array', items: nested }
    expect(boundedPluginToolSchema.safeParse({ type: 'object', properties: { nested } }).success).toBe(false)
    expect(boundedPluginToolSchema.safeParse({
      type: 'object', description: 'x'.repeat(PLUGIN_TOOL_SCHEMA_MAX_BYTES),
    }).success).toBe(false)
  })

  it('bounds descriptor identifiers, timeout, and context size', () => {
    expect(pluginAgentToolDescriptorSchema.safeParse({
      id: 'FindTasks', description: 'Find tasks', risk: 'read', inputSchema,
      handler: '/v1/p/search/find', timeoutMs: 30_001,
    }).success).toBe(false)
    expect(pluginContextSectionDescriptorSchema.safeParse({
      id: 'related_tasks', label: 'Related tasks', order: 10,
      read: '/v1/p/search/context', maxBytes: 1_023, maxTokens: 1_024,
    }).success).toBe(false)
  })
})
