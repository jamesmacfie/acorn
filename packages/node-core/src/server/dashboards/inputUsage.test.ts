import { afterEach, describe, expect, it } from 'vitest'
import type { DashboardPanelContent } from '@acorn/protocol/dashboards.ts'
import type { DataSourceScope } from '@acorn/protocol/dataSources.ts'
import { makeTestDb } from '../../testkit/db'
import { dashboardStore } from './store'
import { pluginInputUsage } from './inputUsage'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
const scope = { workspaceId: 'workspace' }
const panel = (title: string, source: { pluginId: string; sourceId: string }, inputs: DataSourceScope['inputs']): DashboardPanelContent => ({
  title,
  queries: [{
    id: 'rows', label: 'Rows', reference: { kind: 'inline', bindings: {}, content: {
      name: 'Rows', parameters: { type: 'object', properties: {}, additionalProperties: false },
      query: { source, scope: { ...scope, parameters: {}, ...(inputs ? { inputs } : {}) }, sort: [] }, sourceParameters: {},
    } },
  }],
  mapping: { columns: [], fields: {}, values: {}, unmapped: 'catch-all' },
  display: { view: { kind: 'list' }, fields: [] },
})

describe('pluginInputUsage', () => {
  it('counts published panels per input with the accounts they bind, and skips unpublished drafts', () => {
    const test = makeTestDb(); cleanups.push(test.cleanup)
    const store = dashboardStore(test.db)
    const board = { pluginId: 'readiness', sourceId: 'board' }
    const publish = (content: DashboardPanelContent) => {
      const draft = store.create(scope, content)
      store.publish(scope, draft.id, draft.draftRevision)
    }
    publish(panel('Work', board, { pulls: { connectionId: 'work', parameters: {} }, issues: { parameters: {} } }))
    publish(panel('Also work', board, { pulls: { connectionId: 'work', parameters: {} } }))
    publish(panel('Personal', board, { pulls: { connectionId: 'personal', parameters: {} } }))
    publish(panel('Someone else', { pluginId: 'linear', sourceId: 'issues' }, undefined))
    store.create(scope, panel('Draft only', board, { pulls: { connectionId: 'draft', parameters: {} } }))

    expect(pluginInputUsage(test.db, 'readiness')).toEqual({
      board: {
        pulls: { panels: 3, connectionIds: ['personal', 'work'] },
        issues: { panels: 1, connectionIds: [] },
      },
    })
    expect(pluginInputUsage(test.db, 'nobody')).toEqual({})
  })
})
