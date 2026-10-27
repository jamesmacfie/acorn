import { createRoot, createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { CommandExecutionContext, ContributedCommand } from '@acorn/plugin-api/client'
import type { AgentSession } from '../../contract/wire.ts'
import type { AgentProviderUsage } from '../../shared/usage'
import type { AgentPaneModel, SessionAction } from './agentPaneModel'
import { AGENT_SESSION_KEY, AGENT_SESSION_POINT } from '@acorn/protocol/extensionPoints.ts'
import { requestAnnotations } from '@acorn/plugin-api/ui/host'
import { extensionPointRegistry, extensionRegistry, type ExtensionContribution } from '@acorn/plugin-api/testkit/client'

// The header's chip: a session a workflow started says which one, and pressing it opens the run
// (docs/managed-agents/sessions.md § Sessions). The rest of the pane needs a snapshot and a composer, so the
// header is rendered on its own.

const runForSession = vi.fn()
const openPane = vi.fn()
const registerCommands = vi.fn()
const disposeCommands = vi.fn()
const openManagedParent = vi.fn()
const cancel = vi.fn(async () => ({ ok: true }))
const cancelSubagent = vi.fn(async () => ({ ok: true }))
const openAccountTerminal = vi.fn(async () => ({ terminalSessionId: 'term-1' }))
const setTerminalOpen = vi.fn()
const requestTerminalFocusIntent = vi.fn()

const usageReading = (accountName: string | undefined, percentRemaining: number): AgentProviderUsage => ({
  provider: 'claude',
  label: accountName ? `Claude Code · ${accountName}` : 'Claude Code',
  accountName,
  availability: 'available',
  health: 'healthy',
  plan: null,
  account: null,
  quotas: [
    {
      id: 'session',
      label: 'Session',
      percentRemaining,
      resetsAt: null,
      resetText: null,
      windowSeconds: null,
      health: 'healthy',
    },
  ],
  cost: null,
  daily: null,
  capturedAt: 1,
  stale: false,
  error: null,
})

vi.mock('../usage/usageStore', () => ({
  agentUsageStore: {
    init: () => () => {},
    snapshot: () => ({
      providers: [usageReading(undefined, 80), usageReading('personal', 70), usageReading('work', 30)],
      refreshedAt: 1,
    }),
    loading: () => false,
    refreshing: () => false,
    refreshingProviderId: () => null,
    error: () => '',
  },
}))

vi.mock('./managedClient', () => ({ managedAgentApi: { cancel, cancelSubagent, openAccountTerminal } }))

// A stand-in that says which session it shows and whether it takes the caret. The real one needs a
// snapshot, a transcript and a composer, and what the split decides is only which conversations it draws.
vi.mock('./AgentConversation', () => ({
  default: (props: { sessionId: string; autoFocus?: boolean }) => {
    const element = document.createElement('div')
    element.dataset.conversation = props.sessionId
    element.dataset.autofocus = String(!!props.autoFocus)
    return element
  },
}))

vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  clientCapability: () => ({ runForSession }),
  openPane: (...args: unknown[]) => openPane(...args),
  setTerminalOpen: (...args: unknown[]) => setTerminalOpen(...args),
  requestTerminalFocusIntent: (...args: unknown[]) => requestTerminalFocusIntent(...args),
  // Mocked rather than driven through the real registry: what is worth pinning is which commands the
  // pane hands over and what they do when they are asked. The registry is core's to test.
  registerCommands: (...args: unknown[]) => registerCommands(...args) ?? { dispose: disposeCommands },
}))

const { AgentDetailHeader, default: AgentPaneDetail } = await import('./AgentPane')
const { registerSessionActionCommands } = await import('../commands')
const { selectManagedSubagent, clearManagedSubagent } = await import('./managedSelection')

const session = (over: Partial<AgentSession>): AgentSession =>
  ({
    id: 'sess-1',
    taskId: 'task-1',
    providerId: 'claude',
    profileId: 'claude-code',
    kind: 'interactive',
    driverKind: 'acp',
    driverVersion: '1',
    providerSessionRef: null,
    controller: 'acorn',
    runtimeState: 'ready',
    attention: 'none',
    statusAuthority: 'driver',
    title: 'A session',
    model: null,
    config: {},
    parentSessionId: null,
    parentTurnId: null,
    subagents: [],
    lastEventSeq: 0,
    lastReadSeq: 0,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as AgentSession

const modelFor = (current: AgentSession, parent?: AgentSession): AgentPaneModel =>
  ({
    selected: () => current,
    snapshot: () => undefined,
    selectedManagedParent: () => parent,
    openManagedParent,
    sessionActions: () => [],
    providers: () => [{ id: 'claude', defaultAccount: 'personal' }],
    providersLoading: () => false,
    choices: () => [],
    creating: () => false,
    refreshProviders: () => undefined,
    action: (operation: () => Promise<unknown>) => operation(),
  }) as unknown as AgentPaneModel

let host: HTMLDivElement
let dispose: (() => void) | undefined

const mount = (
  current: AgentSession,
  parent?: AgentSession,
  selected?: () => AgentSession,
  over: Partial<AgentPaneModel> = {},
  status: 'active' | 'archived' = 'active',
): void => {
  host = document.createElement('div')
  document.body.append(host)
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  queryClient.setQueryData(['agents', 'pricing'], {
    version: 1,
    claude: { overrides: [], customModels: [] },
    codex: { overrides: [], customModels: [] },
  })
  queryClient.setQueryData(['prefs'], {})
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <AgentDetailHeader
          task={{ id: 'task-1', status } as never}
          model={{ ...modelFor(current, parent), ...(selected ? { selected } : {}), ...over }}
        />
      </QueryClientProvider>
    ),
    host,
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const chip = () => host.querySelector('.ui-chip')

afterEach(() => {
  clearManagedSubagent('sess-1')
  dispose?.()
  host?.remove()
  vi.clearAllMocks()
})

describe('session account usage', () => {
  const usageButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Agent utilization"]')!
  // The popover's account rows; the one that starts open is the account the session runs on.
  const openAccounts = () =>
    [...document.querySelectorAll('details[open] .ui-section-header-label')].map((label) => label.textContent)

  it('uses the selected session account in the header and popover, and follows session changes', async () => {
    const [selected, setSelected] = createSignal(session({ config: { account: 'work' } }))
    mount(selected(), undefined, selected)
    await settle()
    expect(usageButton().textContent).toContain('Claude Code · work 30%')
    usageButton().click()
    await settle()
    expect(openAccounts()).toEqual(['work'])

    setSelected(session({ id: 'sess-2', config: { account: 'personal' } }))
    await settle()
    expect(usageButton().textContent).toContain('Claude Code · personal 70%')
    expect(openAccounts()).toEqual(['personal'])
  })

  it('uses the usual sign-in for a session without a named account', async () => {
    mount(session({ config: {} }))
    await settle()
    expect(usageButton().textContent).toContain('Claude Code 80%')
    usageButton().click()
    await settle()
    expect(openAccounts()).toEqual(['Usual sign-in'])
  })
})

describe('the New menu', () => {
  it('opens a terminal on an account from its row, and offers none for a harness without accounts', async () => {
    const claude = {
      id: 'claude',
      label: 'Claude Code',
      installed: true,
      authenticated: true,
      accounts: [{ name: 'work', label: 'Work', authenticated: true }],
    }
    const codex = { id: 'codex', label: 'Codex', installed: true, authenticated: true }
    mount(session({}), undefined, undefined, {
      choices: () => [{ provider: claude, account: 'work' }, { provider: codex }] as never,
    })
    await settle()
    host.querySelector<HTMLButtonElement>('button[aria-label="New session"]')!.click()
    await settle()
    const terminals = [
      ...document.querySelectorAll<HTMLButtonElement>('.repo-picker-row button[aria-label^="Open a terminal"]'),
    ]
    expect(terminals.map((button) => button.getAttribute('aria-label'))).toEqual(['Open a terminal on Work'])

    terminals[0]!.click()
    await settle()
    expect(openAccountTerminal).toHaveBeenCalledWith('task-1', 'claude', 'work')
    expect(setTerminalOpen).toHaveBeenCalledWith('task-1', true)
    expect(requestTerminalFocusIntent).toHaveBeenCalledWith('task-1', 'term-1')
    expect(document.querySelector('.repo-picker-popover')).toBeNull()
  })

  it('starts the only choice straight from New, with no list to pick from', async () => {
    const codex = { id: 'codex', label: 'Codex', installed: true, authenticated: true }
    const createSession = vi.fn()
    mount(session({}), undefined, undefined, { choices: () => [{ provider: codex }] as never, createSession })
    await settle()
    expect(host.querySelector('button[aria-label="New session"]')).toBeNull()
    host.querySelector<HTMLButtonElement>('button[aria-label="New Codex session"]')!.click()
    expect(createSession).toHaveBeenCalledWith({ provider: codex })
  })
})

describe('stopping the selected agent', () => {
  const stop = () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Stop')!

  it('stops a running Codex child under a ready parent and restores parent controls on return', async () => {
    mount(
      session({
        driverKind: 'codex-app-server',
        providerId: 'codex',
        subagents: [
          { id: 'child-1', title: 'desktop_boundaries', status: 'running', turnId: null, startedAt: 1, updatedAt: 1 },
        ],
      }),
    )
    await settle()
    expect(stop().disabled).toBe(true)
    selectManagedSubagent('sess-1', 'child-1')
    expect(stop().disabled).toBe(false)
    expect(host.textContent).toContain('Working')
    stop().click()
    expect(cancelSubagent).toHaveBeenCalledWith('sess-1', 'child-1')
    expect(cancel).not.toHaveBeenCalled()
    clearManagedSubagent('sess-1')
    expect(stop().disabled).toBe(true)
  })

  it.each([
    ['codex-app-server', 'idle'],
    ['acp', 'running'],
  ])('disables child Stop for %s / %s even when the parent is working', async (driverKind, status) => {
    selectManagedSubagent('sess-1', 'child-1')
    mount(
      session({
        driverKind,
        runtimeState: 'working',
        subagents: [
          {
            id: 'child-1',
            title: 'Child',
            status: status as 'idle' | 'running',
            turnId: null,
            startedAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    )
    await settle()
    expect(stop().disabled).toBe(true)
    clearManagedSubagent('sess-1')
    expect(stop().disabled).toBe(false)
    stop().click()
    expect(cancel).toHaveBeenCalledWith('sess-1')
  })
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
    expect(openPane).toHaveBeenCalledWith('task-1', 'workflows', {
      kind: 'workflows:show-run',
      runId: 'run-1',
      stepId: 'st-2',
    })
  })

  it('stays away from a session a person started', async () => {
    mount(session({}))
    await settle()
    expect(chip()).toBeNull()
    expect(runForSession).not.toHaveBeenCalled()
  })
})

describe('other plugins’ session marks', () => {
  const registrations: { dispose(): void }[] = []
  afterEach(() => registrations.splice(0).forEach((handle) => handle.dispose()))

  it('draws the mark beside the title and opens its credited detail on focus', async () => {
    registrations.push(
      extensionPointRegistry.register({
        id: AGENT_SESSION_POINT,
        ownerId: 'agents',
        label: 'Agent session',
        kind: 'annotation',
        key: [...AGENT_SESSION_KEY],
        max: 2,
        acceptedMarks: 256,
        acceptsDetail: true,
      }),
      extensionRegistry.register({
        id: 'session-health',
        pluginId: 'health',
        point: AGENT_SESSION_POINT,
        label: 'Session health',
        order: 10,
        carrier: 'items',
        marks: async () => [
          {
            key: { session: 'sess-1' },
            severity: 'warn',
            text: 'Watch',
            detail: { kind: 'markdown', value: '**3** failed commands in a row' },
          },
        ],
      } as unknown as ExtensionContribution),
    )
    requestAnnotations(AGENT_SESSION_POINT, [{ session: 'sess-1' }])
    mount(session({}))

    await vi.waitFor(() => expect(host.querySelector('.annotation-inline')).not.toBeNull())
    const mark = host.querySelector<HTMLButtonElement>('.annotation-inline')!
    expect(mark.textContent).toBe('Watch')
    mark.focus()
    const detail = document.querySelector('.annotation-detail')!
    expect(detail.querySelector('strong')?.textContent).toBe('3')
    expect(detail.textContent).toContain('From health')
  })

  it('draws nothing beside the title with no contributor', async () => {
    mount(session({}))
    await settle()
    expect(host.querySelector('.annotation-inline')).toBeNull()
  })
})

describe('managed delegation parent navigation', () => {
  it('names an available managed parent and returns to it', async () => {
    mount(session({ id: 'child', kind: 'delegated' }), session({ id: 'parent', title: 'Parent session' }))
    await settle()
    const parentChip = [...host.querySelectorAll('.ui-chip')].find((item) =>
      item.textContent?.includes('Parent: Parent session'),
    ) as HTMLElement
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
// (docs/managed-agents/palette.md § From the command palette). What is pinned is that the pane model stays
// the only roster — nothing is enumerated a second time — and that a row acts on the action as it is
// when it is picked rather than as it was when it was registered.

/** The action member of the command union, which the facade does not publish by name. */
type ActionRow = Extract<ContributedCommand, { run: unknown }>

describe('the session actions in the palette', () => {
  const item = (over: Partial<SessionAction> & { id: string }): SessionAction => ({
    label: over.id,
    run: () => {},
    ...over,
  })

  const mountCommands = (first: readonly SessionAction[]) => {
    const [actions, setActions] = createSignal<readonly SessionAction[]>(first)
    const model = { sessionActions: actions } as unknown as AgentPaneModel
    const disposeRoot = createRoot((stop) => {
      registerSessionActionCommands(model)
      return stop
    })
    const registered = (): ContributedCommand[] => registerCommands.mock.lastCall![0] as ContributedCommand[]
    const at = (id: string): ActionRow => registered().find((command) => command.id === id) as ActionRow
    return { setActions, registered, at, disposeRoot }
  }

  it('is one group over one row per action, gated on the plugin and on an open task', () => {
    const pane = mountCommands([
      item({ id: 'fork', label: 'Fork session' }),
      item({ id: 'regenerate-title', label: 'Regenerate title' }),
      item({ id: 'archive', label: 'Archive session…' }),
    ])
    expect(pane.registered().map((command) => command.id)).toEqual([
      'agents.session',
      'agents.session.fork',
      'agents.session.regenerate-title',
      'agents.session.archive',
    ])
    expect(pane.registered()[0]).toMatchObject({
      kind: 'group',
      palette: true,
      scope: 'task',
      requires: { plugin: 'agents' },
    })
    expect(pane.at('agents.session.fork')).toMatchObject({ parentId: 'agents.session', palette: true, scope: 'task' })
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
    expect(pane.registered().map((command) => command.id)).toEqual([
      'agents.session',
      'agents.session.fork',
      'agents.session.compact',
    ])
    pane.disposeRoot()
    expect(disposeCommands).toHaveBeenCalledTimes(2)
  })
})

describe('a side question', () => {
  const askSideQuestion = vi.fn()
  const actions = (): SessionAction[] => [
    { id: 'btw', label: 'Ask a side question', run: askSideQuestion },
    { id: 'rename', label: 'Rename session', run: () => {} },
  ]
  const button = (text: string) => [...host.querySelectorAll('button')].find((item) => item.textContent === text)
  const menuLabels = async () => {
    host.querySelector<HTMLButtonElement>('button[aria-label="Session actions"]')!.click()
    await settle()
    return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
  }

  it('is on the bar and in the menu while a turn runs', async () => {
    mount(session({ runtimeState: 'working' }), undefined, undefined, { sessionActions: actions, askSideQuestion })
    await settle()
    button('btw')!.click()
    expect(askSideQuestion).toHaveBeenCalledTimes(1)
    expect(await menuLabels()).toContain('Ask a side question')
  })

  it('is not offered on an archived task, which has no worktree to start a harness in', async () => {
    mount(session({}), undefined, undefined, { sessionActions: actions, askSideQuestion }, 'archived')
    await settle()
    expect(button('btw')).toBeUndefined()
    expect(await menuLabels()).toEqual(['Rename session'])
  })

  it('draws the side session beside the open one with the caret in it, and closing returns to one', async () => {
    const main = session({})
    const side = session({
      id: 'side-1',
      title: 'Side question: A session',
      origin: { kind: 'btw', sourceSessionId: main.id },
    })
    const [open, setOpen] = createSignal<AgentSession | undefined>(side)
    const closeSideSession = vi.fn(() => setOpen(undefined))
    host = document.createElement('div')
    document.body.append(host)
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    queryClient.setQueryData(['agents', 'pricing'], {
      version: 1,
      claude: { overrides: [], customModels: [] },
      codex: { overrides: [], customModels: [] },
    })
    const model = {
      ...modelFor(main),
      taskSessions: () => [main, side],
      error: () => '',
      rosterSettled: () => true,
      dialog: () => null,
      sideSession: open,
      closeSideSession,
    } as unknown as AgentPaneModel
    dispose = render(
      () => (
        <QueryClientProvider client={queryClient}>
          <AgentPaneDetail task={{ id: 'task-1', status: 'active' } as never} model={model} />
        </QueryClientProvider>
      ),
      host,
    )
    await settle()
    const conversations = () =>
      [...host.querySelectorAll<HTMLElement>('[data-conversation]')].map((item) => [
        item.dataset.conversation,
        item.dataset.autofocus,
      ])
    expect(conversations()).toEqual([
      ['side-1', 'true'],
      ['sess-1', 'false'],
    ])
    expect(host.querySelector('[aria-label="Side question"]')?.textContent).toContain('Side question: A session')

    host.querySelector<HTMLButtonElement>('button[aria-label="Close side question"]')!.click()
    await settle()
    expect(closeSideSession).toHaveBeenCalledTimes(1)
    expect(conversations()).toEqual([['sess-1', 'true']])
  })
})
