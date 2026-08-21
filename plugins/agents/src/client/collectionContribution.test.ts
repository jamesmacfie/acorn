import { describe, expect, it } from 'vitest'
import { openPane } from '@acorn/plugin-api/client'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import { agentSessionsCollection, sessionRow } from './collectionContribution'
import { activateManagedAgentPaneIntents, selectedManagedSession } from './managedSelection'

const session = {
  id: 's1',
  taskId: 't1',
  providerId: 'claude',
  runtimeState: 'working',
  attention: 'none',
  title: '',
  model: null,
  updatedAt: 1_700_000_000_000,
} as AgentSession

// The one thing worth pinning: the declared schema and the row mapping can drift apart silently. Rename a
// field id on one side and the panel renders empty cells with nothing thrown anywhere.
describe('agent sessions collection', () => {
  it('fills every declared field, and falls back to the provider for an untitled session', () => {
    const row = sessionRow(session)
    expect(Object.keys(row.values).sort()).toEqual(agentSessionsCollection.schema.fields.map((f) => f.id).sort())
    expect(row.values.title).toBe('claude')
    expect(row.values.state).toBe('working')
  })

  it('sends the click to the session’s own task, and selects it on arrival', () => {
    // Two halves of one click. The row names the task, which is what makes the host navigate there and
    // open this pane; the listener is what turns the host's "row s1 was clicked" into "show session s1".
    const row = sessionRow(session)
    expect(row.taskId).toBe('t1')
    expect(row.action).toEqual({ verb: 'openPane', pane: 'agents' })

    const stop = activateManagedAgentPaneIntents()
    openPane('t1', 'agents', { kind: 'plugin:select', item: row.id })
    expect(selectedManagedSession('t1')).toBe('s1')
    stop()
  })
})
