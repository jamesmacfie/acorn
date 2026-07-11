import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { IdSchema } from '../../shared/publicApi/primitives'
import { defineEndpoint, defineEvent } from './defineEndpoint'
import { generateOpenApi } from './openapi'
import { AutomationApiRegistry } from './registry'

const ok = z.strictObject({ ok: z.boolean() })

function coreEndpoint(over: Partial<Parameters<typeof defineEndpoint>[0]> = {}) {
  return defineEndpoint({
    operationId: 'core.thing.read',
    pluginId: 'core',
    method: 'GET',
    path: '/things',
    scope: 'read',
    risk: 'read',
    summary: 'read a thing',
    response: ok,
    handler: async () => ({ ok: true }),
    ...over,
  })
}

describe('AutomationApiRegistry', () => {
  it('accepts a valid core endpoint and freezes an immutable snapshot', () => {
    const r = new AutomationApiRegistry()
    r.registerEndpoint(coreEndpoint())
    const snap = r.freeze()
    expect(snap.endpoints).toHaveLength(1)
    expect(snap.byOperationId.get('core.thing.read')).toBeDefined()
    expect(r.isFrozen).toBe(true)
    expect(() => r.registerEndpoint(coreEndpoint({ operationId: 'core.thing.other', path: '/other' }))).toThrow(/frozen/)
  })

  it('rejects duplicate operationId and duplicate (method,path)', () => {
    const r = new AutomationApiRegistry()
    r.registerEndpoint(coreEndpoint())
    expect(() => r.registerEndpoint(coreEndpoint({ path: '/elsewhere' }))).toThrow(/Duplicate operationId/)
    expect(() => r.registerEndpoint(coreEndpoint({ operationId: 'core.thing.dup' }))).toThrow(/Duplicate route/)
  })

  it('rejects a mutating endpoint declared with read scope', () => {
    const r = new AutomationApiRegistry()
    expect(() =>
      r.registerEndpoint(
        coreEndpoint({ operationId: 'core.thing.write', method: 'POST', path: '/things', scope: 'read', risk: 'write', body: z.undefined() }),
      ),
    ).toThrow(/must declare scope "write"/)
  })

  it('rejects body on GET and missing body on POST', () => {
    const r = new AutomationApiRegistry()
    expect(() => r.registerEndpoint(coreEndpoint({ body: ok }))).toThrow(/must not declare a body/)
    expect(() =>
      r.registerEndpoint(coreEndpoint({ operationId: 'core.thing.make', method: 'POST', scope: 'write', risk: 'write' })),
    ).toThrow(/must declare a body schema/)
  })

  it('rejects a non-strict (passthrough) public object schema', () => {
    const r = new AutomationApiRegistry()
    expect(() => r.registerEndpoint(coreEndpoint({ response: z.object({ ok: z.boolean() }).loose() }))).toThrow(/must be strict/)
  })

  it('enforces plugin namespace on ids, paths, operationIds, and events', () => {
    const r = new AutomationApiRegistry()
    const base = {
      pluginId: 'github',
      method: 'GET' as const,
      path: '/repos',
      scope: 'read' as const,
      risk: 'read' as const,
      summary: 's',
      response: ok,
      handler: async () => ({ ok: true }),
    }
    // pluginId mismatch vs activation owner
    expect(() => r.registerContribution({ pluginId: 'github', endpoints: [defineEndpoint({ ...base, operationId: 'github.repos.list' })] }, 'notes')).toThrow(/does not match/)
    // operationId not namespaced to the plugin
    expect(() => r.registerContribution({ pluginId: 'github', endpoints: [defineEndpoint({ ...base, operationId: 'repos.list' })] }, 'github')).toThrow(/namespaced/)
    // path must not re-include the /plugins prefix
    expect(() => r.registerContribution({ pluginId: 'github', endpoints: [defineEndpoint({ ...base, operationId: 'github.repos.list', path: '/plugins/github/repos' })] }, 'github')).toThrow(/drop the \/plugins/)
    // event channel namespace
    expect(() => r.registerContribution({ pluginId: 'github', events: [defineEvent({ pluginId: 'github', channel: 'notes.bad', description: 'd', schema: ok, scope: 'read' })] }, 'github')).toThrow(/must be namespaced/)
  })

  it('rejects paths with traversal, wildcards, or version segments', () => {
    const r = new AutomationApiRegistry()
    expect(() => r.registerEndpoint(coreEndpoint({ path: '/a/../b' }))).toThrow(/\.\./)
    expect(() => r.registerEndpoint(coreEndpoint({ path: '/a/*' }))).toThrow(/wildcard/)
    expect(() => r.registerEndpoint(coreEndpoint({ path: '/v2/a' }))).toThrow(/version segment/)
  })

  it('generates OpenAPI 3.1 covering every registered operation', () => {
    const r = new AutomationApiRegistry()
    r.registerEndpoint(coreEndpoint())
    r.registerContribution(
      {
        pluginId: 'changes',
        endpoints: [
          defineEndpoint({
            operationId: 'changes.git.commit',
            pluginId: 'changes',
            method: 'POST',
            path: '/tasks/:taskId/git/commit',
            scope: 'write',
            risk: 'execute',
            summary: 'commit',
            params: z.strictObject({ taskId: IdSchema }),
            body: z.strictObject({ message: z.string().min(1) }),
            response: z.strictObject({ commitSha: z.string() }),
            status: 201,
            handler: async () => ({ commitSha: 'abc' }),
          }),
        ],
      },
      'changes',
    )
    const doc = generateOpenApi(r.freeze()) as { paths: Record<string, unknown> }
    expect(doc.paths['/api/v1/things']).toBeDefined()
    expect(doc.paths['/api/v1/plugins/changes/tasks/{taskId}/git/commit']).toBeDefined()
  })
})
