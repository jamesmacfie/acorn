import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { memoryAgentTools } from './agentTools'
import { MemoryStore } from './memoryStore'

describe('task-scoped memory tools', () => {
  let root: string
  let store: MemoryStore
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'acorn-memory-tools-')); store = new MemoryStore(root) })
  afterEach(() => rm(root, { recursive: true, force: true }))
  const payload = { name: 'topic', description: 'A remembered topic', type: 'project' as const, body: 'A useful fact.' }
  const context = { taskId: 'own-task', sessionId: 'own-session', provenanceProof: 'signed', userLogin: 'owner' }
  const invoke = (tools: ReturnType<typeof memoryAgentTools>, name: string, input: unknown, ctx = context) => tools.find((tool) => tool.name === name)!.handler(input, ctx as never)

  it('writes directly, attributes the signed session, and never reads another project', async () => {
    await store.write({ scope: 'project', projectId: 'foreign', name: 'foreign' }, { ...payload, name: 'foreign' }, { by: 'owner' })
    await store.write({ scope: 'private', projectId: null, name: 'personal' }, { ...payload, name: 'personal' }, { by: 'owner' })
    const tools = memoryAgentTools(store, { tasks: { load: async () => ({ projectId: 'own' }) } } as never)
    const saved = await invoke(tools, 'memory_write', { ...payload, scope: 'project', projectId: 'foreign' }) as { changeId: string }
    expect(saved.changeId).toBeTruthy()
    expect((await store.get({ scope: 'project', projectId: 'own', name: 'topic' }))?.updatedBy).toBe('agent:own-session')
    expect((await invoke(tools, 'memory_list', {}) as { name: string }[]).map((row) => row.name).sort()).toEqual(['personal', 'topic'])
    await expect(invoke(tools, 'memory_get', { name: 'foreign', scope: 'project', projectId: 'foreign' })).rejects.toMatchObject({ kind: 'not_found' })
    const memory = await invoke(tools, 'memory_get', { scope: 'project', name: 'topic' }) as { hash: string }
    await invoke(tools, 'memory_delete', { scope: 'project', name: 'topic', hash: memory.hash })
    expect(await store.get({ scope: 'project', projectId: 'own', name: 'topic' })).toBeNull()
  })

  it('allows private memory for projectless tasks and refuses missing tasks and unsigned writes', async () => {
    const tools = memoryAgentTools(store, { tasks: { load: async (taskId: string) => taskId === 'missing' ? null : { projectId: null } } } as never)
    await invoke(tools, 'memory_write', { ...payload, scope: 'private' })
    expect((await invoke(tools, 'memory_list', {}) as unknown[])).toHaveLength(1)
    await expect(invoke(tools, 'memory_write', { ...payload, scope: 'project' })).rejects.toMatchObject({ kind: 'bad_request' })
    await expect(invoke(tools, 'memory_list', {}, { ...context, taskId: 'missing' })).rejects.toMatchObject({ kind: 'not_found' })
    await expect(invoke(tools, 'memory_write', { ...payload, scope: 'private' }, { ...context, provenanceProof: '' })).rejects.toThrow('Authenticated agent session')
  })
})
