import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MemoryStore } from './memoryStore'
import { memoryLibrary } from './library'
import { standingContextBuilder } from './standingContext'
import type { KnowledgeCoreServices } from './knowledgeChannel'

let root: string
let store: MemoryStore
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'memory-library-')); store = new MemoryStore(root) })
afterEach(() => rm(root, { recursive: true, force: true }))
const address = { scope: 'project' as const, projectId: 'project-a', name: 'deploy' }
const input = { name: 'deploy', description: 'A deployment rule', body: 'Use the release pipeline.', type: 'project' as const }
const agent = { by: 'agent' as const, sessionId: 'session-a', taskId: 'task-a' }

it('keeps edits, scope moves, deletion, history and restoration hash checked', async () => {
  const created = await store.write(address, input, agent)
  await store.edit(address, { ...input, body: 'Owner correction.', hash: created.hash! }, 'project')
  await expect(store.edit(address, { ...input, hash: created.hash! }, 'private')).rejects.toMatchObject({ kind: 'conflict' })
  expect((await store.get(address))?.body).toBe('Owner correction.')
  const versions = await store.history(address)
  expect(versions).toMatchObject([{ body: input.body, updatedBy: 'agent:session-a' }])
  const current = (await store.get(address))!
  await store.edit(address, { ...input, hash: current.hash, name: 'release' }, 'private')
  expect(await store.get(address)).toBeNull()
  const destination = { scope: 'private' as const, projectId: null, name: 'release' }
  expect((await store.get(destination))?.body).toBe(input.body)
  const deleted = await store.delete(destination, (await store.get(destination))!.hash, { by: 'owner' })
  expect(await store.get(destination)).toBeNull()
  const version = (await store.history(destination))[0]
  await store.restore(destination, version.version)
  expect((await store.get(destination))?.body).toBe(input.body)
  await expect(store.undo(deleted.id)).rejects.toMatchObject({ kind: 'conflict' })
  await expect(store.restore(destination, version.version, 'stale')).rejects.toMatchObject({ kind: 'conflict' })
  await expect(store.restore(destination, '../escape')).rejects.toMatchObject({ kind: 'bad_request' })
})

it('refuses a move onto an occupied name without losing either memory', async () => {
  const current = await store.write(address, input, agent)
  const destination = { scope: 'private' as const, projectId: null, name: 'deploy' }
  await store.write(destination, { ...input, body: 'A private preference.' }, { by: 'owner' })
  await expect(store.edit(address, { ...input, hash: current.hash! }, 'private')).rejects.toMatchObject({ kind: 'conflict' })
  expect((await store.get(address))?.body).toBe(input.body)
  expect((await store.get(destination))?.body).toBe('A private preference.')
})

it('limits the feed to the selected project and private scope, with Undo only on the latest content', async () => {
  const initial = await store.write(address, input, agent)
  const updated = await store.write(address, { ...input, hash: initial.hash!, body: 'Updated rule.' }, agent)
  await store.write({ ...address, projectId: 'foreign' }, input, agent)
  await store.write({ scope: 'private', projectId: null, name: 'preference' }, { ...input, name: 'preference' }, { by: 'owner' })
  const feed = await store.feed('project-a')
  expect(feed.map((change) => change.projectId)).toEqual([null, 'project-a', 'project-a'])
  expect(feed.map((change) => change.canUndo)).toEqual([true, true, false])
  const core = { projects: { byId: async () => ({ id: 'project-a' }) } } as unknown as KnowledgeCoreServices
  const projectFeed = await memoryLibrary(store, core)('changes', 'project-a', { scope: 'project' }) as typeof feed
  expect(projectFeed.map((change) => change.projectId)).toEqual(['project-a', 'project-a'])
  await store.undo(updated.id)
  const restored = (await store.get(address))!
  expect(restored.body).toBe(input.body)
  expect(restored.updatedBy).toBe('owner')
  expect(restored.sessionId).toBeUndefined()
  expect(restored.taskId).toBeUndefined()
  expect((await store.feed('project-a'))[0]).toMatchObject({ by: 'owner', action: 'restore' })
  expect((await store.get({ scope: 'private', projectId: null, name: 'preference' }))?.body).toBe(input.body)
})

it('uses the session context builder for preview and applies cap preferences only to later snapshots', async () => {
  let prefs = '{}'
  const core = { projects: { byId: async () => ({ id: 'project-a' }) }, identity: { active: () => 'owner' }, tasks: { load: async () => ({ projectId: 'project-a' }) }, prefs: { read: async () => prefs, write: async (_user: string, _key: string, value: string) => { prefs = value } } } as unknown as KnowledgeCoreServices
  const library = memoryLibrary(store, core)
  for (let i = 0; i < 8; i++) await store.write({ ...address, name: `rule-${i}` }, { ...input, name: `rule-${i}`, description: 'x'.repeat(150) }, agent)
  await store.write({ scope: 'private', projectId: null, name: 'shared-preference' }, { ...input, name: 'shared-preference' }, agent)
  const build = standingContextBuilder(store, core)
  const snapshot = await build('task-a')
  await library('caps', 'project-a', { caps: { project: 500, private: 4000 } })
  const preview = await library('preview', 'project-a', {}) as { text: string; counts: { project: number }; shown: { project: number } }
  expect(preview.text).toEqual(await build('task-a'))
  expect(preview.text).toContain('MEMORY.md truncated:')
  expect(preview.counts.project).toBeGreaterThan(500)
  expect(preview.shown.project).toBeLessThanOrEqual(500)
  expect(snapshot).not.toContain('MEMORY.md truncated:')
  const projectPreview = await library('preview', 'project-a', { scope: 'project' }) as typeof preview
  expect(projectPreview.text).toContain('## Project memory')
  expect(projectPreview.text).not.toContain('shared-preference')
  expect(await build('task-a')).toContain('shared-preference')
  await expect(library('get', 'project-a', { address: { ...address, projectId: 'foreign' } })).rejects.toMatchObject({ status: 400 })
})
