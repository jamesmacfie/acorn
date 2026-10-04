import { describe, expect, it } from 'vitest'
import type { DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import { boardMove } from './boardMoves'

const ref = { pluginId: 'fixture', sourceId: 'issues', recordId: 'one', scope: { parameters: {} } }
const run = {
  plan: { columns: [{ id: 'status', label: 'Status', type: 'enum', bind: { issues: { field: '/state' } },
    choices: [{ id: 'done', label: 'Done', writeValues: { issues: null } }, { id: 'todo', label: 'To do' }] }] },
  diagnostics: { sources: [{ id: 'issues', label: 'Fixture', writable: [{ field: '/state', risk: 'write', values: [null, 'open'] }] }] },
} as unknown as DashboardRun
const row: DashboardDisplayRow = { id: 'one', pluginId: 'fixture', sourceId: 'issues', values: { status: 'todo' },
  records: [ref], sourceFieldValues: { issues: { '/state': 'open' } } }

describe('board moves', () => {
  it('keeps a null target distinct from an absent mapping', () => {
    expect(boardMove(run, row, 'status', 'done')).toMatchObject({ move: { expected: 'open', target: null, ref } })
    expect(boardMove(run, { ...row, values: { status: 'done' } }, 'status', 'todo').reason).toBe('No write value for Fixture here.')
  })

  it('refuses aggregate and equivalent rows instead of choosing a first record', () => {
    expect(boardMove(run, { ...row, records: [ref, { ...ref, recordId: 'two' }] }, 'status', 'done').reason)
      .toContain('not one direct source record')
    expect(boardMove(run, { ...row, summaryStage: 1 }, 'status', 'done').reason)
      .toContain('not one direct source record')
  })

  it('explains changed eligibility and missing current values', () => {
    expect(boardMove(run, { ...row, sourceFieldValues: { issues: {} } }, 'status', 'done').reason)
      .toContain('no current value')
    const unavailable = { ...run, diagnostics: { ...run.diagnostics, sources: [{ id: 'issues', label: 'Fixture', writable: [] }] } }
    expect(boardMove(unavailable, row, 'status', 'done').reason).toContain('does not allow changes')
    expect(boardMove(run, { ...row, sourceWritableFields: { issues: [] } }, 'status', 'done').reason)
      .toContain('no longer allows this record')
  })
})
