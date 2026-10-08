import { SecretService, makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as schema from '../../node/schema'
import { InstructionReviewStore } from './instructionReviewStore'
import { snapshotDigest } from './instructionReviewStore'
import type { InstructionSnapshot } from './instructionSnapshot'

let testDb: TestPluginDb
let store: InstructionReviewStore
beforeEach(() => { testDb = makeTestPluginDb('agents'); store = new InstructionReviewStore(testDb.db, new SecretService('33'.repeat(32))) })
afterEach(() => testDb.cleanup())
const snapshot = (text: string): InstructionSnapshot => ({ version: 1, scope: 'test scope', files: [{
  path: 'AGENTS.md', canonicalPath: '/project/AGENTS.md', sha256: createHash('sha256').update(text).digest('hex'), bytes: text.length,
  text, kind: 'instruction', unsupported: false,
}] })

it('seals bodies, restores approval, retains only two snapshots, and isolates projects', async () => {
  const first = await store.save('one', snapshot('API_KEY=supersecret'))
  await store.approve(first.id, 'one')
  const other = await store.save('two', snapshot('other'))
  await store.approve(other.id, 'two')
  await store.save('one', snapshot('second'))
  await store.save('one', snapshot('third'))
  expect((await store.approved('one'))?.id).toBe(first.id)
  expect((await store.approved('two'))?.id).toBe(other.id)
  const rows = await testDb.db.select().from(schema.agentInstructionSnapshots)
  expect(rows.filter((row) => row.projectId === 'one')).toHaveLength(2)
  expect(rows[0]?.bodyEnc).not.toContain('supersecret')
  expect(rows[0]?.filesJson).not.toContain('supersecret')
  expect((await store.get(first.id))?.bodies[0]?.text).toContain('supersecret')
  await store.deleteProject('one')
  expect(await store.approved('one')).toBeNull()
  expect(await store.approved('two')).not.toBeNull()
})

it('requires renewed review when the encrypted body cannot be opened', async () => {
  const first = await store.save('one', snapshot('instruction'))
  await store.approve(first.id, 'one')
  const differentKey = new InstructionReviewStore(testDb.db, new SecretService('44'.repeat(32)))
  await expect(differentKey.approved('one')).rejects.toThrow()
})

it('recognizes either of two approved task roots in the same project', async () => {
  const one = snapshot('one')
  const two = snapshot('two')
  const first = await store.save('project', one); await store.approve(first.id, 'project')
  const second = await store.save('project', two); await store.approve(second.id, 'project')
  expect((await store.approved('project', snapshotDigest(one)))?.id).toBe(first.id)
  expect((await store.approved('project', snapshotDigest(two)))?.id).toBe(second.id)
  const pending = await store.save('project', snapshot('third'))
  expect(await store.get(pending.id)).not.toBeNull()
  expect((await store.approved('project'))?.id).toBe(second.id)
})

it('does not save a review cancelled while encryption is pending', async () => {
  let finishSeal!: (value: string) => void
  const seal = vi.fn(() => new Promise<string>((resolve) => { finishSeal = resolve }))
  const delayed = new InstructionReviewStore(testDb.db, { seal } as unknown as SecretService)
  const abort = new AbortController()
  const saving = delayed.save('project', snapshot('instruction'), abort.signal)
  expect(seal).toHaveBeenCalledOnce()
  abort.abort()
  finishSeal('encrypted')
  await expect(saving).rejects.toThrow(/cancelled/)
  expect(await testDb.db.select().from(schema.agentInstructionSnapshots)).toEqual([])
})
