import { describe, expect, it } from 'vitest'
import { openPane } from '@acorn/plugin-api/client'
import type { AgentConfigOption, AgentSession } from '@acorn/protocol/managedAgents.ts'
import { agentSessionsCollection, sessionRow } from './collectionContribution'
import { activateManagedAgentPaneIntents, selectedManagedSession } from './sessions/managedSelection'

const session: AgentSession = {
  id: 's1',
  taskId: 't1',
  providerId: 'claude',
  profileId: 'claude',
  kind: 'interactive',
  driverKind: 'acp',
  driverVersion: '1',
  providerSessionRef: null,
  controller: 'acorn',
  runtimeState: 'working',
  attention: 'none',
  statusAuthority: 'protocol',
  title: '',
  model: null,
  config: {
    configOptions: [{
      id: 'model',
      label: 'Model',
      category: 'model',
      currentValue: 'claude-opus-4-1',
      values: [{ value: 'claude-opus-4-1', label: 'Claude Opus 4.1' }],
    }] satisfies AgentConfigOption[],
  },
  parentSessionId: null,
  parentTurnId: null,
  subagents: [],
  lastEventSeq: 0,
  lastReadSeq: 0,
  archivedAt: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

// The one thing worth pinning: the declared schema and the row mapping can drift apart silently. Rename a
// field id on one side and the panel renders empty cells with nothing thrown anywhere.
describe('agent sessions collection', () => {
  it('fills every declared field, and falls back to the provider for an untitled session', () => {
    const row = sessionRow(session)
    expect(Object.keys(row.values).sort()).toEqual(agentSessionsCollection.schema.fields.map((f) => f.id).sort())
    expect(row.values.title).toBe('claude')
    expect(row.values.state).toBe('working')
    // The `model` column is never written, so a row that read it showed an empty column forever.
    expect(row.values.model).toBe('Claude Opus 4.1')
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
