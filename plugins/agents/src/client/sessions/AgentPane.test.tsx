import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import type { AgentPaneModel } from './agentPaneModel'

// The header's chip: a session a workflow started says which one, and pressing it opens the run
// (docs/managed-agents.md § Sessions). The rest of the pane needs a snapshot and a composer, so the
// header is rendered on its own.

const runForSession = vi.fn()
const openPane = vi.fn()

vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  clientCapability: () => ({ runForSession }),
  openPane: (...args: unknown[]) => openPane(...args),
}))

const { AgentDetailHeader } = await import('./AgentPane')

const session = (over: Partial<AgentSession>): AgentSession => ({
  id: 'sess-1', taskId: 'task-1', providerId: 'claude', profileId: 'claude-code', kind: 'interactive',
  driverKind: 'acp', driverVersion: '1', providerSessionRef: null, controller: 'acorn',
  runtimeState: 'ready', attention: 'none', statusAuthority: 'driver', title: 'A session',
  model: null, config: {}, parentSessionId: null, parentTurnId: null, subagents: [],
  lastEventSeq: 0, lastReadSeq: 0, archivedAt: null, createdAt: 1, updatedAt: 1, ...over,
} as AgentSession)

const modelFor = (current: AgentSession): AgentPaneModel => ({
  selected: () => current,
  sessionActions: () => [],
  providers: () => [],
  creating: () => false,
  refreshProviders: () => undefined,
  action: () => undefined,
} as unknown as AgentPaneModel)

let host: HTMLDivElement
let dispose: (() => void) | undefined

const mount = (current: AgentSession): void => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <AgentDetailHeader task={{ id: 'task-1' } as never} model={modelFor(current)} />, host)
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const chip = () => host.querySelector('.ui-chip')

afterEach(() => {
  dispose?.()
  host?.remove()
  vi.clearAllMocks()
})

describe('the workflow chip', () => {
  it('names the run and the step, and opens the run pane there', async () => {
    runForSession.mockResolvedValue({
      run: { id: 'run-1', name: 'Investigate an issue' },
      step: { id: 'st-2', name: 'synthesise' },
    })
    mount(session({ kind: 'workflow', config: { workflowRunId: 'run-1', workflowStepId: 'st-2' } }))
    await settle()

    expect(chip()?.textContent).toContain('Workflow: Investigate an issue · synthesise')
    ;(chip() as HTMLElement).click()
    expect(openPane).toHaveBeenCalledWith('task-1', 'workflows', { kind: 'workflows:show-run', runId: 'run-1', stepId: 'st-2' })
  })

  it('stays away from a session a person started', async () => {
    mount(session({}))
    await settle()
    expect(chip()).toBeNull()
    expect(runForSession).not.toHaveBeenCalled()
  })
})
