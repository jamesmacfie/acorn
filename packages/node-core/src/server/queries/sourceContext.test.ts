import { expect, it } from 'vitest'
import type { QueryContent } from '@acorn/protocol/dataQueries.ts'
import type { Env } from '../bindings'
import { sourceBindingContext } from './sourceContext'

it('resolves a time-only predicate without asking a connectionless source for viewer identity', async () => {
  const content: QueryContent = {
    name: 'Recent tasks', parameters: { type: 'object', additionalProperties: false }, sourceParameters: {},
    query: { source: { pluginId: 'core', sourceId: 'tasks' }, scope: { workspaceId: 'workspace', parameters: {} }, sort: [],
      predicate: { kind: 'comparison', left: { address: { from: 'item', pointer: '/updatedAt' } },
        operator: 'gte', right: { address: { from: 'context', name: 'now', offset: '-P7D' } } } },
  }
  const at = Date.parse('2026-10-04T00:00:00Z')
  expect(await sourceBindingContext({} as Env, content,
    { principal: { kind: 'device', userId: 'owner', deviceId: 'device' }, signal: new AbortController().signal }, at))
    .toEqual({ evaluationTime: at, timePolicy: { zone: 'UTC', weekStart: 'monday' } })
})
