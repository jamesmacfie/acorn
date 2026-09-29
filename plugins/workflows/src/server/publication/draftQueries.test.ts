import { afterEach, beforeEach, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { eq } from 'drizzle-orm'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { workflowDefs } from '../../node/schema'
import { workflowDraftQueries } from './draftQueries'
import { getDef, removeDef } from '../definitions/store'
import { publishFixtureDef } from '../../testkit/publishedDefinition'

let store: TestPluginDb
beforeEach(() => { store = makeTestPluginDb('workflows') })
afterEach(() => store.cleanup())
const def = (...queryIds: string[]): WorkflowDef => ({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Draft', steps: queryIds.map((queryId, i) => ({ id: `find-${i}`, name: `Find ${i}`, kind: 'find-records', query: { kind: 'saved', queryId, bindings: {} } })) })
const input = (...ids: string[]) => ({ workspaceId: 'workspace', projectId: 'project', def: def(...ids) })

it('protects draft references before saving and removes stale references without touching published consumers', async () => {
  const references = new Map<string, Set<string>>([['first', new Set(['published'])]])
  const drafts = workflowDraftQueries(store.db, async (_scope, queryId, consumer, remove) => {
    const set = references.get(queryId) ?? new Set<string>()
    if (remove) set.delete(consumer.id); else set.add(consumer.id)
    references.set(queryId, set)
  })
  const row = await drafts.create(input('first'))
  expect(references.get('first')).toEqual(new Set(['published', `draft:${row.id}`]))
  await drafts.update(row.id, def('second'), 1)
  expect(references.get('first')).toEqual(new Set(['published']))
  expect(references.get('second')).toEqual(new Set([`draft:${row.id}`]))
  await drafts.remove(row.id)
  expect(references.get('second')).toEqual(new Set())
})

it('retains claims across an interrupted registration and reconciles them after restart', async () => {
  const references = new Set<string>()
  let fail = true
  const write: Parameters<typeof workflowDraftQueries>[1] = async (_scope, queryId, consumer, remove) => {
    const key = `${queryId}:${consumer.id}`
    if (remove) references.delete(key); else references.add(key)
    if (fail) { fail = false; throw new Error('Response lost') }
  }
  await expect(workflowDraftQueries(store.db, write).create(input('query'))).rejects.toThrow('Response lost')
  expect(references.size).toBe(1)
  expect(store.db.select().from(workflowDefs).all()).toHaveLength(0)
  await workflowDraftQueries(store.db, write).reconcile()
  expect(references.size).toBe(0)
})

it('keeps the winning reference when another device changes the draft during registration', async () => {
  const references = new Set<string>()
  let change = false
  let id = ''
  const drafts = workflowDraftQueries(store.db, async (_scope, queryId, consumer, remove) => {
    const key = `${queryId}:${consumer.id}`
    if (remove) references.delete(key); else references.add(key)
    if (change) {
      change = false
      store.db.update(workflowDefs).set({ revision: 2, defJson: JSON.stringify(def('winner')) }).where(eq(workflowDefs.id, id)).run()
    }
  })
  id = (await drafts.create(input('original'))).id
  change = true
  expect(await drafts.update(id, def('loser'), 1)).toHaveProperty('conflict')
  expect(references).toEqual(new Set([`winner:draft:${id}`]))
  expect((await getDef(store.db, id))?.revision).toBe(2)
})

it('reconciles draft and published references after deletion interrupted between stores', async () => {
  const references = new Set<string>()
  const write: Parameters<typeof workflowDraftQueries>[1] = async (_scope, queryId, consumer, remove) => {
    const key = `${queryId}:${consumer.id}`
    if (remove) references.delete(key); else references.add(key)
  }
  const row = await workflowDraftQueries(store.db, write).create(input('query'))
  await publishFixtureDef(store.db, row.id)
  references.add(`query:${row.id}`)
  await removeDef(store.db, row.id)
  await workflowDraftQueries(store.db, write).reconcile()
  expect(references.size).toBe(0)
})
