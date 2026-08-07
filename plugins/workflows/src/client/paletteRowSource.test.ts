import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaletteItem } from '@acorn/client-core/palette/model.ts'
import type { WorkflowDefSummary } from '@acorn/protocol/workflow.ts'

const mocks = vi.hoisted(() => ({ defs: vi.fn(), start: vi.fn() }))
vi.mock('../contract/workflowClient', () => ({ workflowApi: { defs: mocks.defs, start: mocks.start } }))

import { workflowsPaletteRowSource as source } from './paletteRowSource'

const def = (id: string, steps = 2): WorkflowDefSummary => ({
  id,
  name: id.toUpperCase(),
  source: 'repo',
  steps: Array.from({ length: steps }, (_, i) => ({ name: `step-${i}` })),
})
const row = (id: string): PaletteItem => ({ kind: 'workflow', id: `workflow:${id}`, label: 'x', hint: 'y' })

describe('workflow palette rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.start.mockResolvedValue(undefined)
  })

  it('declares its place after terminal rows, and its desktop requirement', () => {
    // 20, behind terminal's 10, which reproduces the run → layout → workflow order the palette had when it built
    // all three itself. `requires: 'terminal'` because the runner is a main-process engine.
    expect(source).toMatchObject({ id: 'workflows.defs', order: 20, requires: 'terminal' })
  })

  it('maps committed defs into rows with a step count, and carries config errors alongside', async () => {
    mocks.defs.mockResolvedValue({
      workflows: [def('ship', 3), def('review', 1)],
      errors: [{ source: 'repo', message: 'cycle: a → b → a' }],
    })
    const result = await source.rows('task-1')
    expect(result.rows).toEqual([
      { kind: 'workflow', id: 'workflow:ship', label: 'Workflow: SHIP', hint: '3 steps' },
      { kind: 'workflow', id: 'workflow:review', label: 'Workflow: REVIEW', hint: '1 steps' },
    ])
    // A broken .acorn/workflows/*.toml stays visible instead of silently producing no rows.
    expect(result.errors).toEqual([{ source: 'repo', message: 'cycle: a → b → a' }])
  })

  it('offers nothing without a task, and does not fetch', async () => {
    expect(await source.rows(null)).toEqual({ rows: [] })
    expect(mocks.defs).not.toHaveBeenCalled()
  })

  it('starts the picked def, passing the whole definition rather than re-fetching', async () => {
    mocks.defs.mockResolvedValue({ workflows: [def('ship')], errors: [] })
    await source.rows('task-1')
    await source.invoke(row('ship'), 'task-1')
    expect(mocks.start).toHaveBeenCalledWith('task-1', def('ship'))
  })

  it('passes an error result from start straight through to the palette', async () => {
    mocks.defs.mockResolvedValue({ workflows: [def('ship')], errors: [] })
    await source.rows('task-1')
    mocks.start.mockResolvedValue({ error: 'repo configuration needs review' })
    expect(await source.invoke(row('ship'), 'task-1')).toEqual({ error: 'repo configuration needs review' })
  })

  it('drops a row left over from another task, and one naming a def this task does not have', async () => {
    mocks.defs.mockResolvedValue({ workflows: [def('ship')], errors: [] })
    await source.rows('task-A')
    await source.invoke(row('ship'), 'task-B') // the palette still showing task-A's rows
    await source.invoke(row('nope'), 'task-A')
    await source.invoke(row('ship'), null)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('ignores a row of another kind, since every source sees every pick', async () => {
    mocks.defs.mockResolvedValue({ workflows: [def('ship')], errors: [] })
    await source.rows('task-1')
    await source.invoke({ kind: 'run', id: 'run:dev', label: 'x', hint: 'y', running: false }, 'task-1')
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
