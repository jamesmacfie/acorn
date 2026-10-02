import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore } from './memoryStore'
import { standingContextBuilder } from './standingContext'

describe('standing memory context', () => {
  let root: string
  let store: MemoryStore
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'acorn-memory-context-')); store = new MemoryStore(root) })
  afterEach(() => rm(root, { recursive: true, force: true }))
  const input = { name: 'database', description: 'A database convention', type: 'project' as const, body: 'The full body stays out of the system prompt.' }
  const author = { by: 'owner' as const }
  function builder(projectId: string | null, caps = '{}') {
    return standingContextBuilder(store, { tasks: { load: async () => ({ projectId }) }, identity: { active: () => 'owner' }, prefs: { read: async () => caps } } as never)
  }

  it('uses the contract and just the private and signed project indexes, including external edits', async () => {
    await store.write({ scope: 'project', projectId: 'own', name: input.name }, input, author)
    await store.write({ scope: 'project', projectId: 'foreign', name: 'other-project' }, { ...input, name: 'other-project' }, author)
    await store.write({ scope: 'private', projectId: null, name: 'preference' }, { ...input, name: 'preference' }, author)
    const context = await builder('own')('task')
    expect(context).toContain('Read a memory with `memory_get`')
    expect(context).toContain('[database](database.md)')
    expect(context).toContain('[preference](preference.md)')
    expect(context).not.toContain('other-project')
    expect(context).not.toContain(input.body)
    await writeFile(join(root, 'projects/own/database.md'), '---\nname: database\ndescription: Edited outside Acorn\nmetadata:\n  type: project\n---\nBody')
    expect(await builder('own')('task')).toContain('Edited outside Acorn')
    expect(await builder(null)('task')).not.toContain('## Project memory')
  })

  it('caps each index at a whole line and counts every omitted entry', async () => {
    for (let i = 0; i < 12; i++) await store.write({ scope: 'project', projectId: 'own', name: `entry-${i}` }, { ...input, name: `entry-${i}`, description: 'x'.repeat(100) }, author)
    const context = (await builder('own', JSON.stringify({ project: 500 }))('task'))!
    const index = context.split('## Project memory\n\n')[1]
    expect(index.length).toBeLessThanOrEqual(500)
    expect(index).toMatch(/\[MEMORY\.md truncated: \d+ older entries not shown\. Call memory_list to see every entry\.\]$/)
    const omitted = Number(index.match(/truncated: (\d+)/)![1])
    expect(index.split('\n').filter((line) => line.startsWith('- [')).length + omitted).toBe(12)
  })
})
