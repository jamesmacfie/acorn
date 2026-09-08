import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumePaneIntent } from '@acorn/plugin-api/client'
import type { WorkflowStepRow } from '@acorn/protocol/workflow.ts'
import type { RunPaneModel } from './runPaneModel'

// Which controls a node offers is the pane's whole promise: a stale button is a race, not a bug
// (docs/workflows.md § Routes and UI). So the check is per status, in a real render.

vi.mock('@acorn/plugin-terminal/contract/sessionsClient.ts', () => ({
  terminalSessions: { create: async () => ({ id: 'term-1' }) },
}))
// The detail's one router call, for the link to a child task's own task. A `Route` around the
// component would make every assertion below wait a tick for nothing.
vi.mock('@solidjs/router', () => ({ useNavigate: () => vi.fn() }))

const { default: NodeDetail } = await import('./NodeDetail')

const step = (over: Partial<WorkflowStepRow>): WorkflowStepRow => ({
  id: 'st1', runId: 'run-1', idx: 0, name: 'reproduce', kind: 'agent', mode: 'headless',
  profileId: 'claude-code', model: 'claude-opus-5', status: 'running', resultJson: null,
  structuredJson: null, sessionId: null, agentSessionId: null, costUsd: null, iteration: 0,
  error: null, createdAt: 10, updatedAt: 20, ...over,
})

const kill = vi.fn()
const retry = vi.fn()
const gate = vi.fn()

const modelFor = (row: WorkflowStepRow): RunPaneModel => ({
  selectedStep: () => row,
  busy: () => false,
  error: () => '',
  setError: () => undefined,
  now: () => 100_000,
  eventsFor: () => [],
  tailFor: () => [],
  kill,
  retry,
  gate,
} as unknown as RunPaneModel)

let host: HTMLDivElement
let dispose: (() => void) | undefined

const mount = (row: WorkflowStepRow): void => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeDetail task={{ id: 'task-1' } as never} model={modelFor(row)} />
    </QueryClientProvider>
  ), host)
}

const buttons = (): string[] => [...host.querySelectorAll('button')]
  .map((el) => el.textContent?.trim() ?? '')
  .filter((label) => label && label !== '⧉')

const press = (label: string): void => {
  const found = [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === label)
  if (!found) throw new Error(`no button called '${label}': ${buttons().join(', ')}`)
  found.click()
}

afterEach(() => {
  dispose?.()
  host?.remove()
  vi.clearAllMocks()
})

describe('the controls a node offers', () => {
  it('a running agent node: its session and a way to stop it', () => {
    mount(step({ agentSessionId: 'sess-1' }))
    expect(buttons()).toEqual(['Open in Agent pane', 'Kill step'])
  })

  it('a waiting gate: approve or reject', () => {
    mount(step({ kind: 'gate-human', status: 'waiting-gate' }))
    expect(buttons()).toEqual(['Approve', 'Reject'])
    press('Approve')
    expect(gate).toHaveBeenCalledWith(true)
  })

  it('a finished command node: nothing to press', () => {
    mount(step({ kind: 'terminal:command', status: 'done', structuredJson: JSON.stringify({ exitCode: 0, stdout: 'ok' }) }))
    expect(buttons()).toEqual([])
  })

  it('a failed agent node: retry, and retry with different words', () => {
    mount(step({ status: 'failed', error: 'it broke', inputsJson: JSON.stringify({ prompt: 'find the bug' }) }))
    expect(buttons()).toEqual(['Retry', 'Retry with edited prompt'])
    press('Retry')
    expect(retry).toHaveBeenCalledWith('st1')
  })

  it('a failed command node: retry, and no prompt to edit', () => {
    mount(step({ kind: 'terminal:command', status: 'failed', error: 'exit 1' }))
    expect(buttons()).toEqual(['Retry'])
  })

  it('a step with a captured harness session opens it in a terminal', () => {
    mount(step({ status: 'done', sessionId: 'sess-9', resumeCommand: 'claude --resume sess-9' }))
    expect(buttons()).toEqual(['Open in terminal'])
  })

  it('opens the agent pane at the session the step ran in', () => {
    mount(step({ agentSessionId: 'sess-1' }))
    press('Open in Agent pane')
    expect(consumePaneIntent('task-1', 'agents')).toEqual({ kind: 'plugin:select', item: 'sess-1' })
  })

  it('a run-target node offers its terminal once it reports one', () => {
    mount(step({ kind: 'terminal:run-target', status: 'done', structuredJson: JSON.stringify({ sessionId: 'term-2', url: 'http://localhost:3000' }) }))
    expect(buttons()).toEqual(['Open terminal'])
    expect(host.textContent).toContain('http://localhost:3000')
  })
})
