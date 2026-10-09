import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { refreshFleet, setActiveNode } from '@acorn/plugin-api/testkit/client'
import type { AgentSession } from '../../contract/wire.ts'

let resolveGoal!: (session: AgentSession) => void
const setGoal = vi.fn(() => new Promise<AgentSession>((resolve) => { resolveGoal = resolve }))
vi.mock('./managedClient', () => ({ managedAgentApi: { setGoal } }))

const { default: SessionGoal } = await import('./SessionGoal')
const { managedAgentStore } = await import('./managedStore')

const session = (title: string): AgentSession => ({
  id: 'same-session', taskId: 'task', title, kind: 'interactive', controller: 'acorn',
  archivedAt: null, goal: null,
} as AgentSession)

afterEach(() => {
  managedAgentStore.clear()
  setActiveNode(null)
  delete window.acorn
  vi.clearAllMocks()
})

it('keeps a pending goal write on its origin and ignores its reply after switching Node', async () => {
  Object.assign(window, { acorn: { desktop: true, onNodeStatus: () => () => {},
    fleetList: async () => ({ nodes: ['A', 'B'].map(nodeId => ({ nodeId, label: nodeId,
      endpoint: 'https://localhost', local: true })), statuses: ['A', 'B'].map(nodeId => ({ nodeId, state: 'online' })) }),
  } })
  await refreshFleet()
  setActiveNode('A')
  const [selected, setSelected] = createSignal(session('From A'))
  const [openToken, setOpenToken] = createSignal(0)
  managedAgentStore.upsertSession(selected())
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <SessionGoal session={selected()} openToken={openToken()}
    onUpdate={managedAgentStore.upsertSession} />, host)
  const button = (label: string) => [...document.querySelectorAll('button')]
    .findLast((element) => element.textContent?.trim() === label) as HTMLButtonElement | undefined
  try {
    expect(button('Set goal')).toBeUndefined()
    setOpenToken((token) => token + 1)
    const input = document.querySelector('input')!
    input.value = 'Finish A'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    button('Set goal')!.click()
    expect(setGoal).toHaveBeenCalledWith('same-session', 'Finish A', expect.objectContaining({ nodeId: 'A' }))

    setActiveNode('B')
    managedAgentStore.clear()
    const fromB = session('From B')
    managedAgentStore.upsertSession(fromB)
    setSelected(fromB)
    await Promise.resolve()
    setOpenToken((token) => token + 1)
    const nextInput = document.querySelector('input')!
    nextInput.value = 'Finish B'
    nextInput.dispatchEvent(new Event('input', { bubbles: true }))

    resolveGoal({ ...session('From A'), goal: { objective: 'Finish A', status: 'active', continuations: 0,
      noProgress: 0, verdict: null } })
    await Promise.resolve()
    expect(managedAgentStore.sessions().map((row) => row.title)).toEqual(['From B'])
    expect(document.querySelector('input')?.value).toBe('Finish B')
  } finally {
    dispose()
    host.remove()
  }
})
