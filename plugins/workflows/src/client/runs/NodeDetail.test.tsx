import { createRenderEffect, createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumePaneIntent } from '@acorn/plugin-api/client'
import {
  extensionPointRegistry, extensionRegistry, provideClientCapability, type Disposable, type ExtensionContribution,
} from '@acorn/plugin-api/testkit/client'
import { AGENTS_CONVERSATION, type AgentConversationProps } from '@acorn/plugin-agents/contract/conversation.ts'
import type { WorkflowStepRow } from '../../contract/wire.ts'
import {
  MAX_STEP_BODY_JSON_BYTES, MAX_STEP_BODY_TAIL_LINES, WORKFLOW_STEP_BODY_POINT, type WorkflowStepBodyProps,
} from '../../contract/stepBody.ts'
import type { RunPaneModel } from './runPaneModel'
import type { WorkflowGateForm } from '../../shared/workflowContracts'

// Which controls a node offers is the pane's whole promise: a stale button is a race, not a bug
// (docs/workflows/routes-and-ui.md § Routes and UI). So the check is per status, in a real render.
//
// The second half is which shape a node draws. An agent node hands its detail to the conversation
// plugins/agents publishes, and every other kind — and an agent node on a machine where that plugin
// is switched off — keeps the summary this pane has always drawn.

vi.mock('@acorn/plugin-terminal/contract/sessionsClient.ts', () => ({
  terminalSessions: { create: async () => ({ id: 'term-1' }) },
}))
// The detail's one router call, for the link to a child task's own task. A `Route` around the
// component would make every assertion below wait a tick for nothing.
vi.mock('@solidjs/router', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [{}, vi.fn()] }))

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

const modelFor = (row: WorkflowStepRow, form?: WorkflowGateForm): RunPaneModel => {
  const [drafts, setDrafts] = createSignal<Record<string, Record<string, unknown>>>({})
  return {
  gateForm: () => form,
  gateDraft: (id: string) => drafts()[id],
  setGateDraft: (id: string, values: Record<string, unknown>) => setDrafts((all) => ({ ...all, [id]: values })),
  selectedStep: () => row,
  selectedRun: () => undefined,
  busy: () => false,
  error: () => '',
  setError: () => undefined,
  now: () => 100_000,
  contributedKindLabel: (kind: string) => kind,
  eventsFor: () => [],
  tailFor: () => [],
  kill,
  retry,
  gate,
  } as unknown as RunPaneModel
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

const mount = (row: WorkflowStepRow, form?: WorkflowGateForm): void => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeDetail task={{ id: 'task-1' } as never} model={modelFor(row, form)} />
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

// Nothing provides the conversation unless a test says so, which is also the real answer on a node
// with the agents plugin disabled.
let provided: Disposable | undefined
const registered: Disposable[] = []
const provideConversation = (): Array<Partial<AgentConversationProps>> => {
  const drawn: Array<Partial<AgentConversationProps>> = []
  provided = provideClientCapability(AGENTS_CONVERSATION, {
    Conversation: (props) => {
      // Read every field here, because props are getters and the recorded copy has to be the values
      // this render actually passed.
      drawn.push({
        sessionId: props.sessionId,
        workflowStepId: props.workflowStepId,
        viewKeyPrefix: props.viewKeyPrefix,
        note: props.note,
        noSession: props.noSession,
      })
      return null
    },
  })
  return drawn
}

afterEach(() => {
  dispose?.()
  host?.remove()
  provided?.dispose()
  provided = undefined
  vi.clearAllMocks()
})

describe('the controls a node offers', () => {
  it('a running agent node: its session and a way to stop it', () => {
    mount(step({ agentSessionId: 'sess-1' }))
    expect(buttons()).toEqual(['Open in Agent pane', 'Stop step'])
  })

  it('a waiting gate: approve or reject', () => {
    mount(step({ kind: 'gate-human', status: 'waiting-gate' }))
    expect(buttons()).toEqual(['Approve', 'Reject'])
    press('Approve')
    expect(gate).toHaveBeenCalledWith(true)
  })

  it('a waiting gate with a form: the proposal to correct, then approve with the edited values', () => {
    const form: WorkflowGateForm = { fields: [
      { name: 'title', label: 'Title', schema: { type: 'string' }, required: true },
      { name: 'body', label: 'Release note', schema: { type: 'string' } },
    ] }
    mount(step({ kind: 'gate-human', status: 'waiting-gate', inputsJson: JSON.stringify({ form: { values: { title: 'Draft', body: 'Notes' } } }) }), form)
    const title = host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!
    expect(title.value).toBe('Draft')
    expect(buttons()).toEqual(['Approve', 'Reject'])

    title.value = 'Corrected'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    expect(host.textContent).toContain('Edited')
    press('Approve')
    expect(gate).toHaveBeenCalledWith(true, { title: 'Corrected', body: 'Notes' })

    press('Reset')
    expect(title.value).toBe('Draft')
    title.value = ''
    title.dispatchEvent(new Event('input', { bubbles: true }))
    const approve = [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === 'Approve')!
    expect(approve.disabled).toBe(true)
  })

  it('an approved gate with a form: the approved values, edits marked', () => {
    const form: WorkflowGateForm = { fields: [{ name: 'title', label: 'Title', schema: { type: 'string' } }] }
    mount(step({ kind: 'gate-human', status: 'done', structuredJson: JSON.stringify({ approved: true, values: { title: 'Corrected' }, edited: ['title'] }) }), form)
    expect(buttons()).toEqual([])
    expect(host.textContent).toContain('Title (edited)')
    expect(host.textContent).toContain('Corrected')
  })

  it('a finished command node: nothing to press', () => {
    mount(step({ kind: 'terminal:command', status: 'done', structuredJson: JSON.stringify({ exitCode: 0, stdout: 'ok' }) }))
    expect(buttons()).toEqual([])
  })

  it('a failed agent node: retry, and retry with different words', () => {
    mount(step({ status: 'failed', error: 'it broke', inputsJson: JSON.stringify({ prompt: 'find the bug' }) }))
    expect(buttons()).toEqual(['Edit prompt and retry', 'Retry'])
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

describe('which shape a node draws', () => {
  it('an agent node draws the conversation, named by the step rather than the session', () => {
    const drawn = provideConversation()
    mount(step({}))

    // The step, because a running step has no session id on its row yet: the runner writes that in the
    // completion patch. The agents client is the half that can turn one into the other.
    expect(drawn[0]?.workflowStepId).toBe('st1')
    expect(drawn[0]?.sessionId).toBeUndefined()
    // Its own scroll place, so following live here does not drag the Agent pane's view about.
    expect(drawn[0]?.viewKeyPrefix).toBe('workflows')
    // Sending mid-step is legal and surprising, so the box says what it does.
    expect(drawn[0]?.note).toContain('runs after it finishes')
  })

  it('says nothing about sending once the step has stopped', () => {
    const drawn = provideConversation()
    mount(step({ status: 'done', agentSessionId: 'sess-1' }))

    expect(drawn[0]?.note).toBeUndefined()
    expect(drawn[0]?.sessionId).toBe('sess-1')
  })

  it('names the Agent pane as the other place to see it', () => {
    provideConversation()
    mount(step({ agentSessionId: 'sess-1' }))
    // Not "Open": the conversation is already open, here.
    expect(buttons()).toEqual(['Show in Agent pane', 'Stop step'])
  })

  it('says why there is no transcript, in the words this pane knows', () => {
    const drawn = provideConversation()
    mount(step({ status: 'done' }))
    // A step with no managed session ran as a bare process. "No session" on its own reads as a bug;
    // the reason and where the output went are the useful part.
    expect(drawn[0]?.noSession).toContain('without a conversation')
    expect(drawn[0]?.noSession).toContain('Step details')
  })

  it('says a pending step has not started rather than that it ran', () => {
    const drawn = provideConversation()
    mount(step({ status: 'pending' }))
    expect(drawn[0]?.noSession).toBe('This step has not started yet.')
  })

  it('keeps the summary when nothing provides a conversation', () => {
    mount(step({}))
    // The harness and the model, which is what this pane drew before the transcript was here.
    expect(host.textContent).toContain('claude-code')
    expect(buttons()).toEqual(['Stop step'])
  })

  it('leaves every other kind the shape it had', () => {
    provideConversation()
    mount(step({ kind: 'terminal:command', status: 'done', structuredJson: JSON.stringify({ exitCode: 3 }) }))
    expect(host.textContent).toContain('Exit code')
    expect(buttons()).toEqual([])
  })
})

describe('the workflows:step-body point', () => {
  // Compiled contributors, so no worker is involved: which render path answers is client-core's to
  // test. What this pane owns is the key, the props, and what stays outside the slot.
  const seen: WorkflowStepBodyProps[] = []
  let mounts = 0
  const point = () => registered.push(extensionPointRegistry.register({
    id: WORKFLOW_STEP_BODY_POINT, ownerId: 'workflows', label: 'Workflow step result', kind: 'remote', mode: 'replace', max: 1,
  }))
  const contributor = (pluginId: string, matches: string[]) => {
    const registration = extensionRegistry.register({
      id: `plugin:${pluginId}:step-body`, pluginId, point: WORKFLOW_STEP_BODY_POINT, label: `${pluginId} body`, order: 500,
      carrier: 'component', matches,
      // A provider that knows only the contract: no Workflows client state, no run model.
      component: (body: WorkflowStepBodyProps) => {
        mounts++
        createRenderEffect(() => seen.push({ ...body, ...(body.tail ? { tail: [...body.tail] } : {}) }))
        return <span>drawn by {pluginId}: {JSON.stringify(body.output)}</span>
      },
    } as ExtensionContribution)
    registered.push(registration)
    return registration
  }

  // A model whose selected step and tail can move, as the real one's do on socket events.
  const live = (first: WorkflowStepRow) => {
    const [row, setRow] = createSignal(first)
    const [tails, setTails] = createSignal<Record<string, readonly string[]>>({})
    const model = { ...modelFor(first), selectedStep: row, selectedRunId: () => row().runId, tailFor: (id: string) => tails()[id] ?? [] } as unknown as RunPaneModel
    return { model, setRow, setTails }
  }
  const mountModel = (model: RunPaneModel): void => {
    host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NodeDetail task={{ id: 'task-1', projectId: 'project-1' } as never} model={model} />
      </QueryClientProvider>
    ), host)
  }

  const http = step({ id: 'st-http', kind: 'http:request', status: 'done', structuredJson: JSON.stringify({ status: 201, headers: {}, body: 'made' }) })

  afterEach(() => {
    for (const registration of registered.splice(0).reverse()) registration.dispose()
    seen.length = 0
    mounts = 0
  })

  it('hands the body to the plugin that runs the kind, and keeps Retry outside it', () => {
    point()
    contributor('http', ['http:request'])
    mount({ ...http, status: 'failed', error: 'timed out' })
    expect(host.textContent).toContain('drawn by http: {"status":201,"headers":{},"body":"made"}')
    expect(host.textContent).not.toContain('Status')
    expect(seen.at(-1)).toEqual({
      taskId: 'task-1', runId: 'run-1', stepId: 'st-http', kind: 'http:request', status: 'failed',
      inputs: null, inputsTruncated: false, output: { status: 201, headers: {}, body: 'made' }, outputTruncated: false,
      revision: expect.any(Number),
    })
    // The header, the error and Retry are this pane's, whoever draws the body.
    expect(host.textContent).toContain('timed out')
    press('Retry')
    expect(retry).toHaveBeenCalledWith('st-http')
  })

  it('lets a provider draw a kind this pane has never heard of', () => {
    point()
    contributor('acme', ['acme:deploy'])
    mount(step({ kind: 'acme:deploy', status: 'done', structuredJson: JSON.stringify({ url: 'https://example.com' }) }))
    expect(host.textContent).toContain('drawn by acme: {"url":"https://example.com"}')
  })

  it('draws its own body when nobody matches, when two tie, and once the provider is disabled', () => {
    point()
    contributor('acme', ['acme:deploy'])
    mount(http)
    expect(host.textContent).toContain('Status')
    expect(host.textContent).not.toContain('drawn by')
    dispose?.()
    host.remove()

    const provider = contributor('http', ['http:request'])
    const rival = contributor('rival', ['http:*'])
    mount(http)
    expect(host.textContent).toContain('Status')
    expect(host.textContent).not.toContain('drawn by')

    rival.dispose()
    expect(host.textContent).toContain('drawn by http')
    provider.dispose()
    expect(host.textContent).not.toContain('drawn by')
    expect(host.textContent).toContain('Status')
  })

  it('hands over null for JSON that does not parse, and says so when output is too big', () => {
    point()
    contributor('http', ['http:request'])
    mount({ ...http, structuredJson: '{"status": 2', inputsJson: JSON.stringify({ note: 'small' }) })
    expect(seen.at(-1)).toMatchObject({ inputs: { note: 'small' }, output: null, outputTruncated: false })
    expect(host.textContent).not.toContain('64 KiB')
    dispose?.()
    host.remove()

    const huge = JSON.stringify({ status: 200, body: 'x'.repeat(MAX_STEP_BODY_JSON_BYTES) })
    mount({ ...http, structuredJson: huge })
    expect(seen.at(-1)).toMatchObject({ output: null, outputTruncated: true, inputsTruncated: false })
    expect(host.textContent).toContain('This step\'s output is over 64 KiB, so the plugin drawing it didn\'t get it.')
  })

  it('updates a running step in place, with its tail and a rising revision', () => {
    point()
    contributor('acme', ['acme:deploy'])
    const running = step({ id: 'st-deploy', kind: 'acme:deploy', status: 'running' })
    const { model, setRow, setTails } = live(running)
    mountModel(model)
    const first = seen.at(-1)!
    expect(first.tail).toBeUndefined()

    setTails({ 'st-deploy': ['building', 'pushing'] })
    expect(seen.at(-1)?.tail).toEqual(['building', 'pushing'])
    setTails({ 'st-deploy': Array.from({ length: 250 }, (_, i) => `line ${i}`) })
    expect(seen.at(-1)?.tail).toHaveLength(MAX_STEP_BODY_TAIL_LINES)
    expect(seen.at(-1)?.tail?.at(-1)).toBe('line 249')

    setRow({ ...running, status: 'done', structuredJson: JSON.stringify({ url: 'https://example.com' }) })
    expect(seen.at(-1)).toMatchObject({ status: 'done', output: { url: 'https://example.com' } })
    expect(seen.at(-1)!.revision).toBeGreaterThan(first.revision)
    // One mount for all of it: an update is new props, not a new provider.
    expect(mounts).toBe(1)
    expect(buttons()).toEqual([])
  })

  it('follows the selection to another run and step, and ignores what arrives for the old one', () => {
    point()
    contributor('acme', ['acme:deploy'])
    const first = step({ id: 'st-a', runId: 'run-1', kind: 'acme:deploy', status: 'running' })
    const { model, setRow, setTails } = live(first)
    mountModel(model)
    setRow(step({ id: 'st-b', runId: 'run-2', kind: 'acme:deploy', status: 'done', structuredJson: '{"url":"b"}' }))
    expect(seen.at(-1)).toMatchObject({ runId: 'run-2', stepId: 'st-b', output: { url: 'b' } })

    // The old step's output, landing after the person moved on.
    setTails({ 'st-a': ['late'] })
    expect(seen.at(-1)).toMatchObject({ runId: 'run-2', stepId: 'st-b' })
    expect(seen.at(-1)?.tail).toBeUndefined()
    expect(host.textContent).toContain('drawn by acme: {"url":"b"}')
  })

  it('draws the new Node\'s step after a Node switch, and nothing from the old pane', () => {
    point()
    contributor('acme', ['acme:deploy'])
    const before = live(step({ id: 'st-a', kind: 'acme:deploy', status: 'running' }))
    mountModel(before.model)
    // A Node switch retires the pane model and the pane mounts again with the new Node's.
    dispose?.()
    host.remove()
    const after = live(step({ id: 'st-z', runId: 'run-z', kind: 'acme:deploy', status: 'done', structuredJson: '{"url":"z"}' }))
    mountModel(after.model)
    const count = seen.length
    before.setTails({ 'st-a': ['from the old Node'] })
    expect(seen.length).toBe(count)
    expect(seen.at(-1)).toMatchObject({ runId: 'run-z', stepId: 'st-z', output: { url: 'z' } })
  })

  it('falls back to its own body when a loaded provider\'s tree fails, and moves nothing', async () => {
    point()
    // A loaded contribution whose bundle this client cannot load. The tree reports it failed.
    registered.push(extensionRegistry.register({
      id: 'plugin:broken:step-body', pluginId: 'broken', point: WORKFLOW_STEP_BODY_POINT, label: 'broken body', order: 500,
      carrier: 'remote', entry: 'stepBody', hash: 'missing', matches: ['http:request'],
    } as ExtensionContribution))
    mount({ ...http, status: 'failed', error: 'timed out' })
    await vi.waitFor(() => expect(host.textContent).toContain('Status'))
    expect(host.textContent).toContain('Failed')
    expect(gate).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
    press('Retry')
    expect(retry).toHaveBeenCalledWith('st-http')
  })

  it('never opens a waiting gate to a provider, and the gate still answers', () => {
    point()
    contributor('sneaky', ['gate-human'])
    mount(step({ kind: 'gate-human', status: 'waiting-gate' }))
    expect(mounts).toBe(0)
    expect(host.textContent).not.toContain('drawn by')
    press('Approve')
    expect(gate).toHaveBeenCalledWith(true)
  })

  it('never hands an agent step\'s live conversation to a provider', () => {
    point()
    contributor('sneaky', ['agent'])
    const drawn = provideConversation()
    mount(step({ agentSessionId: 'sess-1' }))
    expect(drawn).toHaveLength(1)
    expect(mounts).toBe(0)
  })
})
