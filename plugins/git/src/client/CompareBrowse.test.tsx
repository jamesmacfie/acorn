import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { Comparison } from '../shared/api'

const [node, setNode] = createSignal('node-a')
const [project, setProject] = createSignal<string | undefined>('project-a')
const [pinned, setPinned] = createSignal(false)
const navigate = vi.fn()
const writeJson = vi.fn<(...args: unknown[]) => Promise<Comparison>>()
vi.mock('@solidjs/router', () => ({
  useParams: () => ({ get projectId() { return project() } }),
  useMatch: () => () => pinned() ? { params: { source: 'a'.repeat(40), destination: 'b'.repeat(40), mode: 'direct', base: 'a'.repeat(40) } } : null,
  useNavigate: () => navigate,
}))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: { refs: [] } }) }))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  latestSignal: (await original<typeof import('@acorn/plugin-api/client')>()).latestSignal, onScopeEvicted: () => () => {}, activeNodeId: node, writeJson }))
vi.mock('./refsClient', () => ({ refsOptions: () => ({ queryKey: ['refs'] }) }))

const { CompareSourceList } = await import('./CompareBrowse')
let host: HTMLElement | null = null
let dispose = () => {}
afterEach(() => { dispose(); host?.remove(); host = null; setNode('node-a'); setProject('project-a'); setPinned(false); navigate.mockReset(); writeJson.mockReset() })
const draw = () => { host = document.createElement('div'); document.body.append(host); dispose = render(() => <CompareSourceList />, host) }
const field = (label: string) => host!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const edit = (label: string, value: string) => { const input = field(label); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }
const pin = () => [...host!.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Pin comparison')!.click()
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

it('drops late comparison errors and navigation after Node or project replacement', async () => {
  let reject!: (error: Error) => void
  writeJson.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  draw()
  edit('Source full commit ID (optional)', 'a'.repeat(40))
  edit('Destination full commit ID (optional)', 'b'.repeat(40))
  pin()
  setNode('node-b'); setProject('project-b')
  await tick()
  reject(new Error('old comparison failed'))
  await tick()
  expect(field('Source full commit ID (optional)').value).toBe('')
  expect(field('Destination full commit ID (optional)').value).toBe('')
  expect(host!.textContent).not.toContain('old comparison failed')
  expect(navigate).not.toHaveBeenCalled()
  writeJson.mockResolvedValueOnce({ source: 'c'.repeat(40), destination: 'd'.repeat(40), mode: 'direct', base: 'c'.repeat(40) })
  edit('Source full commit ID (optional)', 'c'.repeat(40)); edit('Destination full commit ID (optional)', 'd'.repeat(40)); pin()
  await tick()
  expect(navigate).toHaveBeenCalledWith(`/p/project-b/x/git/compare/${'c'.repeat(40)}/${'d'.repeat(40)}/direct/${'c'.repeat(40)}`)
})

it('keeps a pinned route on first project hydration but clears it when the actual Node changes', async () => {
  setProject(undefined); setPinned(true)
  draw()
  setProject('project-a')
  await tick()
  expect(navigate).not.toHaveBeenCalled()
  setNode('node-b')
  await tick()
  expect(navigate).toHaveBeenCalledWith('/p/project-a/x/git/compare')
})

it('restores comparison inputs on remount and keeps each project and Node separate', async () => {
  setProject('retained-comparison')
  draw()
  edit('Source full commit ID (optional)', 'a'.repeat(40))
  edit('Destination full commit ID (optional)', 'b'.repeat(40))
  dispose(); host?.remove()
  draw()
  expect(field('Source full commit ID (optional)').value).toBe('a'.repeat(40))
  setProject('other-comparison')
  await tick()
  expect(field('Source full commit ID (optional)').value).toBe('')
  edit('Source full commit ID (optional)', 'c'.repeat(40))
  setProject('retained-comparison')
  await tick()
  expect(field('Destination full commit ID (optional)').value).toBe('b'.repeat(40))
  setNode('node-b')
  await tick()
  expect(field('Source full commit ID (optional)').value).toBe('')
  setNode('node-a')
  await tick()
  expect(field('Source full commit ID (optional)').value).toBe('a'.repeat(40))
})
