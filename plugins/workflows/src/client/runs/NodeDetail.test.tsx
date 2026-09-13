import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumePaneIntent } from '@acorn/plugin-api/client'
import { provideClientCapability, type Disposable } from '@acorn/plugin-api/testkit/client'
import { AGENTS_CONVERSATION, type AgentConversationProps } from '@acorn/plugin-agents/contract/conversation.ts'
import type { WorkflowStepRow } from '@acorn/protocol/workflow.ts'
import type { RunPaneModel } from './runPaneModel'

// Which controls a node offers is the pane's whole promise: a stale button is a race, not a bug
// (docs/workflows.md § Routes and UI). So the check is per status, in a real render.
//
// The second half is which shape a node draws. An agent node hands its detail to the conversation
// plugins/agents publishes, and every other kind — and an agent node on a machine where that plugin
// is switched off — keeps the summary this pane has always drawn.

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
  selectedRun: () => undefined,
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

// Nothing provides the conversation unless a test says so, which is also the real answer on a node
// with the agents plugin disabled.
let provided: Disposable | undefined
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
    expect(buttons()).toEqual(['Show in Agent pane', 'Kill step'])
  })

  it('says why there is no transcript, in the words this pane knows', () => {
    const drawn = provideConversation()
    mount(step({ status: 'done' }))
    // A step with no managed session ran as a bare process. "No session" on its own reads as a bug;
    // the reason and where the output went are the useful part.
    expect(drawn[0]?.noSession).toContain('headless')
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
    expect(buttons()).toEqual(['Kill step'])
  })

  it('leaves every other kind the shape it had', () => {
    provideConversation()
    mount(step({ kind: 'terminal:command', status: 'done', structuredJson: JSON.stringify({ exitCode: 3 }) }))
    expect(host.textContent).toContain('Exit code')
    expect(buttons()).toEqual([])
  })
})
