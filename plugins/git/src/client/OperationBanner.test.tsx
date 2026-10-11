import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { OperationState } from '../shared/api'

const [state, setState] = createSignal<OperationState | undefined>()
const writeJson = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const openPane = vi.fn()
const onResolve = vi.fn()
const setQueryData = vi.fn()
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ get data() { return state() }, error: null }),
  useQueryClient: () => ({ setQueryData, invalidateQueries: vi.fn() }),
}))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  latestSignal: (await original<typeof import('@acorn/plugin-api/client')>()).latestSignal, activeNodeId: () => 'node', nodeReady: () => true, openPane, readJson: vi.fn(), writeJson,
  clientEvents: { on: () => () => {} }, wsOnNodeEvent: () => () => {}, wsOnReconnect: () => () => {} }))

const { OperationBanner } = await import('./OperationBanner')
const task = { id: 'task', projectId: 'project', title: 'Task' } as Parameters<typeof OperationBanner>[0]['task']
const observed = (patch: Partial<OperationState>): OperationState => ({ taskId: 'task', checkout: '/checkout', branch: 'main', head: 'a'.repeat(40),
  operation: 'merge', source: 'b'.repeat(40), conflicts: [], busy: [], ...patch })
let host: HTMLElement | null = null
let dispose = () => {}
afterEach(() => { dispose(); host?.remove(); host = null; setState(undefined); writeJson.mockReset(); openPane.mockReset(); onResolve.mockReset() })
const draw = () => { host = document.createElement('div'); document.body.append(host); dispose = render(() => <OperationBanner task={task} onResolve={onResolve} />, host) }
const button = (label: string) => [...host!.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label)

it('opens a conflicted file in the resolver and keeps Continue disabled until it is staged', () => {
  setState(observed({ conflicts: [{ path: 'src/a file.ts', stages: [1, 2, 3] }] }))
  draw()
  expect(host!.textContent).toContain('Merge in progress')
  expect(host!.textContent).toContain('base, ours, theirs')
  expect(button('Continue')!.disabled).toBe(true)
  expect(button('Skip commit')).toBeUndefined()
  ;[...host!.querySelectorAll<HTMLElement>('[role="option"], [role="row"], [role="treeitem"]')].find((row) => row.textContent?.includes('src/a file.ts'))!.click()
  expect(onResolve).toHaveBeenCalledWith('src/a file.ts', '/checkout')
  button('Stage in Changes')!.click()
  expect(openPane).toHaveBeenCalledWith('task', 'git', { kind: 'plugin:select', item: 'changes' })
})

it('continues explicitly with the observed operation and shows Git output when it stops', async () => {
  setState(observed({ operation: 'rebase' }))
  writeJson.mockResolvedValueOnce({ ok: false, error: 'CONFLICT (content): Merge conflict in shared', state: observed({ operation: 'rebase', conflicts: [{ path: 'shared', stages: [1, 2, 3] }] }) })
  draw()
  expect(button('Skip commit')).toBeDefined()
  button('Continue')!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(writeJson.mock.calls[0]![0]).toBe('/v1/p/git/tasks/task/operation/continue')
  expect(JSON.parse((writeJson.mock.calls[0]![1] as { body: string }).body)).toEqual({ expectedPath: '/checkout', operation: 'rebase' })
  expect(host!.textContent).toContain('CONFLICT (content)')
})

it('offers no continue or abort for a conflicted stash', () => {
  setState(observed({ operation: null, source: null, conflicts: [{ path: 'shared', stages: [1, 2, 3] }] }))
  draw()
  expect(host!.textContent).toContain('Unresolved conflicts')
  expect(button('Continue')).toBeUndefined()
  expect(button('Abort')).toBeUndefined()
  expect(button('Stage in Changes')).toBeDefined()
})

it('draws nothing for a clean checkout', () => {
  setState(observed({ operation: null, source: null }))
  draw()
  expect(host!.textContent).toBe('')
})
