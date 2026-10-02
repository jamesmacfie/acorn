import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'

const mocks = vi.hoisted(() => ({ undo: vi.fn(), openMemory: vi.fn(), navigate: vi.fn() }))
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('./memoryClient', () => ({ memoryApi: () => ({ undo: mocks.undo }) }))
vi.mock('./memorySelection', () => ({ openMemory: mocks.openMemory }))
import { MemoryToolCard } from './MemoryToolCard'

let host: HTMLDivElement, dispose: () => void
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
afterEach(() => { dispose?.(); host?.remove(); vi.resetAllMocks() })
function draw(tool: AgentToolCardProps['tool']) {
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => <MemoryToolCard tool={tool} taskId="task" defaultOpen />, host)
}
const saved: AgentToolCardProps['tool'] = { id: 'tool', name: 'memory_write', title: 'Memory', status: 'completed', input: '{"name":"testing","scope":"project"}', output: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ projectId: 'project-1', changeId: 'change-1', name: 'testing', scope: 'project', description: 'Use the isolated profile.' }) }] }) }
const button = (text: string) => [...host.querySelectorAll('button')].find(button => button.textContent === text)!

describe('memory transcript actions', () => {
  it('opens the exact scope and undoes a successful MCP write once', async () => {
    mocks.undo.mockResolvedValue({})
    draw(saved)
    expect(host.textContent).toContain('Saved project memory testing')
    expect(host.textContent).toContain('Use the isolated profile.')
    button('Open').click()
    expect(mocks.openMemory).toHaveBeenCalledWith('testing', 'project', 'project-1', mocks.navigate)
    button('Undo').click(); await settle()
    expect(mocks.undo).toHaveBeenCalledWith('change-1')
    expect(button('Undone').disabled).toBe(true)
    expect(host.textContent).toContain('Undid project memory testing')
  })

  it('shows an Undo conflict and keeps the saved memory available', async () => {
    mocks.undo.mockRejectedValue(new Error('A later change exists.'))
    draw({ ...saved, name: 'memory_delete' })
    expect(host.textContent).toContain('Deleted project memory testing')
    button('Undo').click(); await settle()
    expect(host.textContent).toContain('A later change exists.')
    expect(button('Undo').disabled).toBe(false)
    expect(button('Open')).toBeDefined()
  })

  it.each(['pending', 'failed'] as const)('offers no actions for a %s call', (status) => {
    draw({ ...saved, status, output: 'Memory refused: a private key.' })
    expect(host.querySelectorAll('button')).toHaveLength(0)
    expect(host.textContent).toContain('Memory refused: a private key.')
  })
})
