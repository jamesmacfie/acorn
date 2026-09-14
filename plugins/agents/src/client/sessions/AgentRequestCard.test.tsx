import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// The reveal that a "Needs you" notice drives is a navigation command, not a standing state. A pane
// derives the card's `focus` from a row it rebuilds on every streamed event, so the reveal effect is
// re-notified while the value stays true. It must land the reader once and then leave the caret alone.
describe('revealing a request without stealing the caret', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  const elsewhere = () => {
    const field = document.createElement('textarea')
    document.body.append(field)
    hosts.push(() => field.remove())
    field.focus()
    return field
  }

  it('takes focus once, then leaves it alone through later updates', async () => {
    const [tick, setTick] = createSignal(0)
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => <AgentRequestCard request={request(false)} focused={tick() >= 0} />, host)
    hosts.push(() => { dispose(); host.remove() })
    await flush()
    const card = host.querySelector<HTMLElement>('.ui-card')!
    expect(document.activeElement).toBe(card)

    const field = elsewhere()
    expect(document.activeElement).toBe(field)

    // A streamed update re-notifies the reveal while `focused` stays true.
    setTick(1)
    await flush()
    expect(document.activeElement).toBe(field)
  })

  it('reveals again after focus goes off and back on', async () => {
    const [on, setOn] = createSignal(true)
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => <AgentRequestCard request={request(false)} focused={on()} />, host)
    hosts.push(() => { dispose(); host.remove() })
    await flush()
    const card = host.querySelector<HTMLElement>('.ui-card')!
    expect(document.activeElement).toBe(card)

    elsewhere()
    setOn(false)
    await flush()
    setOn(true)
    await flush()
    expect(document.activeElement).toBe(card)
  })
})
