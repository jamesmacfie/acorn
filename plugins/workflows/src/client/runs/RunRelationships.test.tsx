import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import type { WorkflowChildRunSummary, WorkflowRunProjection, WorkflowStepProjection } from '../../shared/api'
import { ChildRuns, RunLineage } from './RunRelationships'

const tasks = [
  { id: 'root-task', title: 'Ticket review batch' },
  { id: 'child-task', title: 'Review ACORN-42' },
] as Task[]

const child = (over: Partial<WorkflowChildRunSummary> = {}): WorkflowChildRunSummary => ({
  parentTaskId: 'root-task', parentRunId: 'root-run', parentStepId: 'map-step', itemKey: 'ticket-42',
  taskId: 'child-task', runId: 'child-run', name: 'Review ticket', dispatchState: 'run-started',
  runStatus: 'gated', resultSummary: null, error: null,
  usage: { costUsd: 0.12, inputTokens: 1200, outputTokens: 340, turns: 1 }, updatedAt: 20,
  ...over,
})

const step = (children: WorkflowChildRunSummary[]): WorkflowStepProjection => ({
  id: 'map-step', runId: 'root-run', idx: 1, name: 'review', kind: 'workflow-map', mode: 'headless',
  profileId: null, model: null, status: 'waiting-children', resultJson: null, structuredJson: null,
  sessionId: null, agentSessionId: null, costUsd: null, iteration: 0, error: null,
  createdAt: 10, updatedAt: 20, children,
})

let host: HTMLDivElement
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
})

describe('workflow run relationships', () => {
  it('shows map progress, gate attention, usage, task and run links, and a child result', () => {
    const open = vi.fn()
    host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => (
      <ChildRuns
        step={step([
          child(),
          child({ itemKey: 'ticket-43', taskId: 'missing-task', runId: 'failed-run', runStatus: 'failed', error: 'Review failed.', resultSummary: '{"reviewed":false}' }),
        ])}
        tasks={tasks}
        onOpen={open}
      />
    ), host)

    expect(host.textContent).toContain('1 of 2 finished')
    expect(host.textContent).toContain('1 need approval')
    expect(host.textContent).toContain('1 failed')
    expect(host.textContent).toContain('1 turn · 1,200 input · 340 output')
    expect(host.textContent).toContain('Review failed.')
    const result = [...host.querySelectorAll('summary')].find((summary) => summary.textContent?.includes('Result'))
    const details = result?.parentElement as HTMLDetailsElement | undefined
    if (details) {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    }
    expect(host.textContent).toContain('{"reviewed":false}')

    const runLink = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Review ticket')
    runLink?.click()
    expect(open).toHaveBeenCalledWith('child-task', 'child-run')
  })

  it('links a child run to its explicit parent and root lineage', () => {
    const open = vi.fn()
    const run: WorkflowRunProjection = {
      id: 'child-run', taskId: 'child-task', name: 'Review ticket', status: 'running', posture: 'gated',
      error: null, createdAt: 10, updatedAt: 20, rootRunId: 'root-run', parentRunId: 'root-run',
      parentStepId: 'map-step', rootTaskId: 'root-task', rootRunName: 'Ticket review batch',
      parentTaskId: 'root-task', parentRunName: 'Ticket review batch', depth: 1, usage: null,
    }
    host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => <RunLineage run={run} tasks={tasks} onOpen={open} />, host)

    expect(host.textContent).toContain('Parent and root task')
    expect(host.textContent).toContain('Parent and root run')
    const parentRun = [...host.querySelectorAll('button')].filter((button) => button.textContent === 'Ticket review batch').at(-1)
    parentRun?.click()
    expect(open).toHaveBeenCalledWith('root-task', 'root-run')
  })
})
