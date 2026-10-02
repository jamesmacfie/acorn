import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { ChangesToolCard } from './ToolCard'

const { dispatchLayout } = vi.hoisted(() => ({ dispatchLayout: vi.fn() }))
vi.mock('@acorn/plugin-api/client', async (original) => ({ ...await original<Record<string, unknown>>(), dispatchLayout }))

const hosts: Array<() => void> = []
afterEach(() => { for (const dispose of hosts.splice(0)) dispose(); dispatchLayout.mockClear() })

function draw(fileChanges: AgentToolCardProps['fileChanges']) {
  const host = document.createElement('div')
  document.body.append(host)
  const [changes, setChanges] = createSignal(fileChanges)
  const dispose = render(() => <ChangesToolCard
    taskId="task" defaultOpen={false}
    tool={{ id: 'edit', title: 'Changed /repo/src/a.ts', paths: ['/repo/src/a.ts'], status: 'completed' }}
    fileChanges={changes()}
  />, host)
  hosts.push(() => { dispose(); host.remove() })
  return { host, setChanges }
}

it('opens onto the recorded diff and keeps it open as the full patch replaces an excerpt', async () => {
  const { host, setChanges } = draw([{ path: '/repo/src/a.ts', patch: '@@ -1 +1 @@\n-old\n+excerpt', snippet: true }])
  const fold = host.querySelector('details')!
  expect(fold.querySelector('summary')?.textContent).toContain('Changed src/a.ts')
  expect(host.textContent).not.toContain('excerpt')
  fold.open = true
  fold.dispatchEvent(new Event('toggle'))
  await vi.waitFor(() => expect(host.querySelector('.diff-del')?.textContent).toContain('old'))
  expect(host.querySelector('.diff-add')?.textContent).toContain('excerpt')
  expect([...host.querySelectorAll('.diff-gutter')].every((gutter) => gutter.textContent === '')).toBe(true)
  setChanges([{ path: '/repo/src/a.ts', patch: '@@ -9 +9 @@\n-old\n+final' }])
  expect(fold.open).toBe(true)
  expect(host.querySelector('.diff-add')?.textContent).toContain('final')
  expect(host.querySelector('.diff-add .diff-gutter:nth-child(2)')?.textContent).toBe('9')
  const buttons = [...host.querySelectorAll('button')]
  expect(buttons.some((button) => button.textContent === '/repo/src/a.ts')).toBe(false)
  buttons.find((button) => button.textContent === 'Open in Changes')!.click()
  expect(dispatchLayout).toHaveBeenCalledWith('task', { type: 'show', pane: 'changes' })
})

it.each([
  [{ path: '/repo/src/a.ts', patchArtifactId: 'artifact' }, 'This diff is too large to show here.'],
  [{ path: '/repo/src/a.ts' }, 'No recorded diff is available.'],
] as const)('explains an unavailable recorded patch and keeps the Changes action', async (change, message) => {
  const { host } = draw([change])
  const fold = host.querySelector('details')!
  fold.open = true
  fold.dispatchEvent(new Event('toggle'))
  await vi.waitFor(() => expect(host.textContent).toContain(message))
  expect(host.textContent).toContain('/repo/src/a.ts')
  expect(host.textContent).toContain('Open in Changes')
})
