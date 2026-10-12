import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ reads: vi.fn(), writes: vi.fn() }))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  latestSignal: (await original<typeof import('@acorn/plugin-api/client')>()).latestSignal,
  readJson: mocks.reads,
  writeJson: mocks.writes,
}))
const { default: InstructionReviewPanel } = await import('./InstructionReviewPanel')
const hosts: Array<() => void> = []
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
afterEach(() => {
  for (const clear of hosts.splice(0)) clear()
  mocks.reads.mockReset()
  mocks.writes.mockReset()
})

it('shows findings before collapsed diffs and does not approve a review after switching Nodes', async () => {
  mocks.reads.mockImplementation(async (path: string) =>
    path.endsWith('/projects')
      ? [{ id: 'project', name: 'Project' }]
      : {
          id: 'review',
          projectId: 'project',
          branch: 'main',
          digest: 'digest',
          scope: 'nested instructions and skills',
          baseline: true,
          findings: [{ file: 'AGENTS.md', line: 1, category: 'domain', detail: 'External domain: example.org' }],
          changes: [
            {
              path: 'AGENTS.md',
              status: 'added',
              patch: 'Index: AGENTS.md\n--- AGENTS.md\n+++ AGENTS.md\n@@ -0,0 +1 @@\n+safe instruction',
              beforeCanonical: null,
              afterCanonical: '/repo/AGENTS.md',
            },
          ],
          limits: 'Pre-turn scan only.',
        },
  )
  const host = document.createElement('div')
  document.body.append(host)
  const [node, setNode] = createSignal('node-a')
  const dispose = render(() => <InstructionReviewPanel nodeId={node()} />, host)
  hosts.push(() => {
    dispose()
    host.remove()
  })
  await settle()
  const review = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Review instruction files'),
  )!
  review.click()
  await settle()
  const card = [...host.querySelectorAll('.ui-card')].find((card) => card.textContent?.includes('AGENTS.md'))!
  expect(card.textContent).toContain('Website link')
  expect(card.textContent).toContain('Line 1')
  expect(card.textContent).toContain('External domain')
  expect(host.textContent).not.toContain('nested instructions and skills')
  expect(host.querySelector('details')?.open).toBe(false)
  expect(host.textContent).not.toContain('safe instruction')
  const preview = host.querySelector('details')!
  preview.open = true
  preview.dispatchEvent(new Event('toggle'))
  await settle()
  expect(host.querySelector('.diff-add')?.textContent).toContain('safe instruction')
  expect(host.querySelector('.diff-del')).toBeNull()
  expect(host.textContent).not.toContain('Index: AGENTS.md')
  setNode('node-b')
  await settle()
  expect(host.textContent).not.toContain('External domain')
  expect(
    [...host.querySelectorAll('button')].some((button) => button.textContent?.includes('Approve these instructions')),
  ).toBe(false)
  expect(mocks.writes).not.toHaveBeenCalled()
})

it('opens review when enabled and reduces an approved unchanged review to one status', async () => {
  let approved = false
  mocks.reads.mockImplementation(async (path: string) =>
    path.endsWith('/projects')
      ? [
          { id: 'other', name: 'Another project' },
          { id: 'project', name: 'Current project' },
        ]
      : {
          id: 'review',
          projectId: 'project',
          branch: 'main',
          digest: 'digest',
          scope: 'technical scan limits',
          baseline: !approved,
          approved,
          findings: [],
          changes: [],
          limits: 'Detailed restrictions.',
        },
  )
  mocks.writes.mockImplementation(async () => {
    approved = true
  })
  const host = document.createElement('div')
  document.body.append(host)
  const [enabled, setEnabled] = createSignal(false)
  const dispose = render(() => <InstructionReviewPanel enabled={enabled()} preferredProjectId="project" />, host)
  hosts.push(() => {
    dispose()
    host.remove()
  })
  await settle()
  expect(mocks.reads).toHaveBeenCalledTimes(1)
  setEnabled(true)
  await settle()
  expect(mocks.reads).toHaveBeenLastCalledWith(expect.stringContaining('?projectId=project'), expect.anything())
  expect(host.textContent).toContain('Review instructions before agents use them')
  expect(mocks.writes).not.toHaveBeenCalled()
  const button = (label: string) => [...host.querySelectorAll('button')].find((button) => button.textContent === label)!
  button('Approve instructions').click()
  await settle()
  expect(host.textContent).toContain('Instructions approved')
  button('Check again').click()
  await settle()
  expect(host.textContent).toContain('No changes since your approval')
  expect(host.textContent).not.toContain('Approve instructions')
  expect(host.textContent).not.toContain('What was checked')
  expect(host.textContent).not.toContain('technical scan limits')
  expect(mocks.writes).toHaveBeenCalledTimes(1)
})

it('cancels a pending review when switching Nodes and ignores its late response', async () => {
  let finish!: (review: unknown) => void
  mocks.reads.mockImplementation((path: string) =>
    path.endsWith('/projects')
      ? Promise.resolve([{ id: 'project', name: 'Project' }])
      : new Promise((resolve) => {
          finish = resolve
        }),
  )
  const host = document.createElement('div')
  document.body.append(host)
  const [node, setNode] = createSignal('node-a')
  const dispose = render(() => <InstructionReviewPanel nodeId={node()} />, host)
  hosts.push(() => {
    dispose()
    host.remove()
  })
  await settle()
  host.querySelectorAll('button').forEach((button) => {
    if (button.textContent === 'Review instruction files') button.click()
  })
  await settle()
  const signal = mocks.reads.mock.calls.at(-1)![1].signal as AbortSignal
  setNode('node-b')
  await settle()
  expect(signal.aborted).toBe(true)
  finish({ id: 'stale', projectId: 'project', findings: [], changes: [], baseline: true })
  await settle()
  expect(host.textContent).not.toContain('Approve instructions')
  expect(mocks.writes).not.toHaveBeenCalled()
})

it('shows an empty scan without an approval action or unrelated approval links', async () => {
  mocks.reads.mockImplementation(async (path: string) =>
    path.endsWith('/projects')
      ? [{ id: 'project', name: 'Project' }]
      : { id: null, projectId: 'project', empty: true, approved: false, changes: [], findings: [] },
  )
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <InstructionReviewPanel enabled />, host)
  hosts.push(() => {
    dispose()
    host.remove()
  })
  await settle()
  expect(host.textContent).toContain('No instruction files to review')
  expect(host.textContent).toContain('You can start an agent')
  expect(host.textContent).not.toContain('Approve instructions')
  expect(host.textContent).not.toContain('Other approvals')
  expect(host.textContent).not.toContain('Approval applies')
  expect(mocks.writes).not.toHaveBeenCalled()
})
