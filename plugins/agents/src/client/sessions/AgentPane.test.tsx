import { createRoot, createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandExecutionContext, ContributedCommand } from '@acorn/plugin-api/client'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import type { AgentPaneModel, SessionAction } from './agentPaneModel'

// The header's chip: a session a workflow started says which one, and pressing it opens the run
// (docs/managed-agents.md § Sessions). The rest of the pane needs a snapshot and a composer, so the
// header is rendered on its own.

const runForSession = vi.fn()
const openPane = vi.fn()
const registerCommands = vi.fn()
const disposeCommands = vi.fn()
const openManagedParent = vi.fn()

vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  clientCapability: () => ({ runForSession }),
  openPane: (...args: unknown[]) => openPane(...args),
  // Mocked rather than driven through the real registry: what is worth pinning is which commands the
  // pane hands over and what they do when they are asked. The registry is core's to test.
  registerCommands: (...args: unknown[]) => registerCommands(...args) ?? { dispose: disposeCommands },
}))

const { AgentDetailHeader } = await import('./AgentPane')
const { registerSessionActionCommands } = await import('../commands')

const session = (over: Partial<AgentSession>): AgentSession => ({
  id: 'sess-1', taskId: 'task-1', providerId: 'claude', profileId: 'claude-code', kind: 'interactive',
  driverKind: 'acp', driverVersion: '1', providerSessionRef: null, controller: 'acorn',
  runtimeState: 'ready', attention: 'none', statusAuthority: 'driver', title: 'A session',
  model: null, config: {}, parentSessionId: null, parentTurnId: null, subagents: [],
  lastEventSeq: 0, lastReadSeq: 0, archivedAt: null, createdAt: 1, updatedAt: 1, ...over,
} as AgentSession)

const modelFor = (current: AgentSession, parent?: AgentSession): AgentPaneModel => ({
  selected: () => current,
  selectedManagedParent: () => parent,
  openManagedParent,
  sessionActions: () => [],
  providers: () => [],
  creating: () => false,
  refreshProviders: () => undefined,
  action: () => undefined,
} as unknown as AgentPaneModel)

let host: HTMLDivElement
let dispose: (() => void) | undefined

const mount = (current: AgentSession, parent?: AgentSession): void => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <AgentDetailHeader task={{ id: 'task-1' } as never} model={modelFor(current, parent)} />, host)
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

describe('managed delegation parent navigation', () => {
  it('names an available managed parent and returns to it', async () => {
    mount(session({ id: 'child', kind: 'delegated' }), session({ id: 'parent', title: 'Parent session' }))
    await settle()
    const parentChip = [...host.querySelectorAll('.ui-chip')]
      .find((item) => item.textContent?.includes('Parent: Parent session')) as HTMLElement
    expect(parentChip).toBeTruthy()
    parentChip.click()
    expect(openManagedParent).toHaveBeenCalledOnce()
  })

  it('does not invent navigation when the managed parent is missing', async () => {
    mount(session({ id: 'orphan', kind: 'delegated' }))
    await settle()
    expect(host.textContent).not.toContain('Parent:')
  })
})

// The open session's ••• menu, mirrored into the palette while this region is mounted
// (docs/managed-agents.md § From the command palette). What is pinned is that the pane model stays
// the only roster — nothing is enumerated a second time — and that a row acts on the action as it is
// when it is picked rather than as it was when it was registered.

/** The action member of the command union, which the facade does not publish by name. */
type ActionRow = Extract<ContributedCommand, { run: unknown }>

describe('the session actions in the palette', () => {
  const item = (over: Partial<SessionAction> & { id: string }): SessionAction =>
    ({ label: over.id, run: () => {}, ...over })

  const mountCommands = (first: readonly SessionAction[]) => {
    const [actions, setActions] = createSignal<readonly SessionAction[]>(first)
    const model = { sessionActions: actions } as unknown as AgentPaneModel
    const disposeRoot = createRoot((stop) => {
      registerSessionActionCommands(model)
      return stop
    })
    const registered = (): ContributedCommand[] => registerCommands.mock.lastCall![0] as ContributedCommand[]
    const at = (id: string): ActionRow =>
      registered().find((command) => command.id === id) as ActionRow
    return { setActions, registered, at, disposeRoot }
  }

  it('is one group over one row per action, gated on the plugin and on an open task', () => {
    const pane = mountCommands([
      item({ id: 'fork', label: 'Fork session' }),
      item({ id: 'archive', label: 'Archive session…' }),
    ])
    expect(pane.registered().map((command) => command.id))
      .toEqual(['agents.session', 'agents.session.fork', 'agents.session.archive'])
    expect(pane.registered()[0])
      .toMatchObject({ kind: 'group', palette: true, scope: 'task', requires: { plugin: 'agents' } })
    expect(pane.at('agents.session.fork'))
      .toMatchObject({ parentId: 'agents.session', palette: true, scope: 'task' })
    expect((pane.at('agents.session.fork').title as () => string)()).toBe('Fork session')
    pane.disposeRoot()
  })

  it('does not offer an action the menu would draw disabled', () => {
    const pane = mountCommands([item({ id: 'terminal', disabled: true, description: 'No session reference.' })])
    expect(pane.at('agents.session.terminal').when!()).toBe(false)
    pane.setActions([item({ id: 'terminal' })])
    // Same id, so nothing was registered again: the row simply became available.
    expect(registerCommands).toHaveBeenCalledTimes(1)
    expect(pane.at('agents.session.terminal').when!()).toBe(true)
    pane.disposeRoot()
  })

  it('runs the action as it is now, and re-registers only when the roster changes', () => {
    const stale = vi.fn()
    const fresh = vi.fn()
    const pane = mountCommands([item({ id: 'fork', run: stale })])
    pane.setActions([item({ id: 'fork', run: fresh })])
    pane.at('agents.session.fork').run({} as CommandExecutionContext)
    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalled()
    // A new action is a new row, so this one does register again.
    pane.setActions([item({ id: 'fork' }), item({ id: 'compact' })])
    expect(disposeCommands).toHaveBeenCalledTimes(1)
    expect(pane.registered().map((command) => command.id))
      .toEqual(['agents.session', 'agents.session.fork', 'agents.session.compact'])
    pane.disposeRoot()
    expect(disposeCommands).toHaveBeenCalledTimes(2)
  })
})
