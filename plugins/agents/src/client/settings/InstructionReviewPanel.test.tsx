import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ reads: vi.fn(), writes: vi.fn() }))
vi.mock('@acorn/plugin-api/client', () => ({ readJson: mocks.reads, writeJson: mocks.writes }))
const { default: InstructionReviewPanel } = await import('./InstructionReviewPanel')
const hosts: Array<() => void> = []
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
afterEach(() => { for (const clear of hosts.splice(0)) clear(); mocks.reads.mockReset(); mocks.writes.mockReset() })

it('shows findings before collapsed diffs and does not approve a review after switching Nodes', async () => {
  mocks.reads.mockImplementation(async (path: string) => path.endsWith('/tasks')
    ? [{ id: 'task', title: 'Project task', projectId: 'project' }]
    : { id: 'review', taskId: 'task', projectId: 'project', digest: 'digest', scope: 'nested instructions and skills', baseline: true,
      findings: [{ file: 'AGENTS.md', line: 1, category: 'domain', detail: 'External domain: example.org' }],
      changes: [{ path: 'AGENTS.md', status: 'added', patch: '+safe instruction', beforeCanonical: null, afterCanonical: '/repo/AGENTS.md' }],
      limits: 'Pre-turn scan only.' })
  const host = document.createElement('div'); document.body.append(host)
  const [node, setNode] = createSignal('node-a')
  const dispose = render(() => <InstructionReviewPanel nodeId={node()} />, host)
  hosts.push(() => { dispose(); host.remove() })
  await settle()
  const review = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Review instruction files'))!
  review.click(); await settle()
  expect(host.textContent!.indexOf('External domain')).toBeLessThan(host.textContent!.indexOf('added: AGENTS.md'))
  expect(host.querySelector('details')?.open).toBe(false)
  setNode('node-b'); await settle()
  expect(host.textContent).not.toContain('External domain')
  expect([...host.querySelectorAll('button')].some((button) => button.textContent?.includes('Approve these instructions'))).toBe(false)
  expect(mocks.writes).not.toHaveBeenCalled()
})
