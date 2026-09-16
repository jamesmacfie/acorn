import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'

const startup = vi.hoisted(() => ({ localNodeStarting: true }))

vi.mock('../../infra/node/activeNode', () => ({
  activeNodeStarting: () => startup.localNodeStarting,
  nodeReadiness: () => ({ kind: 'ready' as const }),
  selectActiveNode: vi.fn(),
}))

const { default: NodeGate } = await import('./NodeGate')

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.innerHTML = ''
})

it('shows the startup loader after fleet selection while the local node is still starting', () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <NodeGate />, host)

  expect(host.textContent).toContain('starting local node…')
})
