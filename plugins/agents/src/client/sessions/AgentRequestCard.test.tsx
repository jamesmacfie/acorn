import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRequest } from '@acorn/protocol/managedAgents.ts'

// A question that takes more than one answer. The control is a column of checkboxes rather than the
// dropdown a single-choice question gets, and what it posts has to stay an array all the way to the
// agent: a harness that asked for several and is handed one string cannot tell them apart.

const posted: unknown[] = []
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    resolve: async (_sessionId: string, _requestId: string, resolution: unknown) => {
      posted.push(resolution)
    },
  },
}))

const { default: AgentRequestCard } = await import('./AgentRequestCard')

const request = (multiple: boolean): AgentRequest => ({
  id: 'row-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  providerRequestId: 'ask-1',
  kind: 'question',
  status: 'pending',
  title: 'Which checks should run?',
  detail: null,
  payload: {
    options: [],
    questions: [{
      id: 'checks',
      prompt: 'Which checks should run?',
      multiple,
      options: [{ id: 'lint', label: 'Lint' }, { id: 'test', label: 'Test' }],
    }],
  },
  resolution: null,
  expiresAt: null,
  createdAt: 0,
  resolvedAt: null,
})

const hosts: Array<() => void> = []
afterEach(() => {
  for (const teardown of hosts.splice(0).reverse()) teardown()
  posted.length = 0
})

const drawRequest = (value: AgentRequest) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AgentRequestCard request={value} />, host)
  hosts.push(() => { dispose(); host.remove() })
  return host
}

const draw = (multiple: boolean) => drawRequest(request(multiple))

const submit = async (host: HTMLElement) => {
  const button = [...host.querySelectorAll('button')].find((el) => el.textContent?.includes('Submit'))
  button?.click()
  await Promise.resolve()
}

describe('answering a question that takes more than one answer', () => {
  it('posts every box that was ticked, as an array', async () => {
    const host = draw(true)
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes).toHaveLength(2)
    for (const box of boxes) box.click()
    await submit(host)
    expect(posted).toEqual([{ answers: { checks: ['Lint', 'Test'] } }])
  })

  it('drops a box that was ticked and then cleared', async () => {
    const host = draw(true)
    const [lint, test] = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    lint.click()
    test.click()
    lint.click()
    await submit(host)
    expect(posted).toEqual([{ answers: { checks: ['Test'] } }])
  })

  it('still gives a single-choice question one dropdown and one string', async () => {
    const host = draw(false)
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    const select = host.querySelector('select')
    expect(select).not.toBeNull()
    select!.value = 'Test'
    select!.dispatchEvent(new Event('change', { bubbles: true }))
    await submit(host)
    expect(posted).toEqual([{ answers: { checks: 'Test' } }])
  })

  it('keeps a secret free-text answer out of view while it is typed', () => {
    const host = drawRequest({
      ...request(false),
      payload: {
        options: [],
        questions: [{ id: 'token', prompt: 'Paste the token', secret: true }],
      },
    })
    expect(host.querySelector('input[type="password"]')).not.toBeNull()
  })
})
