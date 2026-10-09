import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'

const [node, setNode] = createSignal('node-a')
const writeJson = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; reason?: string }>>()
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: [
  { id: 'task-a', title: 'First task', projectId: 'project', status: 'active' },
  { id: 'task-b', title: 'Second task', projectId: 'project', status: 'active' },
] }) }))
vi.mock('@acorn/plugin-api/client', () => ({ activeNodeId: node, tasksOptions: () => ({ queryKey: ['tasks'] }), writeJson }))
vi.mock('./launchWorkflow', () => ({ sameGitActionScope: (captured: string, projectId: string, current: string) => captured === node() && projectId === current }))

const { TaskRemoteActions } = await import('./TaskRemoteActions')
let host: HTMLElement | null = null
let dispose = () => {}
afterEach(() => { dispose(); host?.remove(); host = null; setNode('node-a'); writeJson.mockReset(); for (const menu of document.querySelectorAll('.ui-select-popover')) menu.remove() })
const draw = () => { host = document.createElement('div'); document.body.append(host); dispose = render(() => <TaskRemoteActions projectId="project" />, host) }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label)!
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const select = (label: string) => { host!.querySelector<HTMLButtonElement>('button[aria-label="Target task"]')!.click(); button(label).click() }

it('does not show old-task feedback on a replacement task or Node', async () => {
  let settle!: (value: { ok: boolean; reason?: string }) => void
  writeJson.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  draw()
  select('First task')
  button('Pull fast-forward only').click()
  select('Second task')
  settle({ ok: false, reason: 'First task failed' })
  await tick()
  expect(host!.textContent).not.toContain('First task failed')
  expect(button('Push').disabled).toBe(false)
  writeJson.mockResolvedValueOnce({ ok: true })
  button('Push').click()
  await tick()
  expect(host!.textContent).toContain('Pushed Second task.')
  setNode('node-b')
  await tick()
  expect(host!.textContent).not.toContain('Pushed Second task.')
  expect(button('Push').disabled).toBe(true)
})
