import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { GitSettings, IdentityWriteResult } from '../shared/api'

const [node, setNode] = createSignal('node-a')
const [project, setProject] = createSignal('project-a')
const writeJson = vi.fn<(...args: unknown[]) => Promise<IdentityWriteResult>>()
const setQueryData = vi.fn()
const invalidateQueries = vi.fn()
const settings: GitSettings = {
  repository: '/repo-a',
  name: { value: 'Original', local: 'Original', global: null, scope: 'local', origin: '.git/config' },
  email: { value: 'old@example.test', local: 'old@example.test', global: null, scope: 'local', origin: '.git/config' },
  pullPolicy: 'ff-only', autoFetch: false,
}
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: readonly unknown[] }) => ({
    get data() { return options().queryKey[0] === 'git-settings' ? settings : [{ id: project(), name: project(), path: '/repo-a', vcs: 'git' }] },
    get error() { return null },
  }),
  useQueryClient: () => ({ setQueryData, invalidateQueries }),
}))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: node, projectsOptions: () => ({ queryKey: ['projects'] }), prefsOptions: () => ({ queryKey: ['prefs'] }),
  createSettingSave: () => ({ error: () => '', savedAt: () => null, run: (action: () => Promise<unknown>) => action() }),
  useUnsavedChanges: () => {}, savePref: async () => {}, PrefKeys: { gitGraphVisible: 'graph', diffView: 'diff' }, writeJson,
}))

const { default: GitSettingsPage } = await import('./GitSettings')
let host: HTMLElement | null = null
let dispose = () => {}
afterEach(() => { dispose(); host?.remove(); host = null; setNode('node-a'); setProject('project-a'); writeJson.mockReset(); setQueryData.mockReset(); invalidateQueries.mockReset() })
const draw = () => { host = document.createElement('div'); document.body.append(host); dispose = render(() => <GitSettingsPage />, host) }
const field = (label: string) => host!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const edit = (label: string, value: string) => { const input = field(label); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }
const button = (label: string) => [...host!.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const result = (nameOk: boolean, emailOk: boolean): IdentityWriteResult => ({
  name: { ok: nameOk, error: nameOk ? null : 'name refused' }, email: { ok: emailOk, error: emailOk ? null : 'email refused' },
  settings, readbackError: null,
})

it('keeps edits made during a save and reports partial failure for retry', async () => {
  let settle!: (value: IdentityWriteResult) => void
  writeJson.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  draw()
  edit('Author name', 'Submitted')
  button('Save identity').click()
  edit('Author name', 'Edited while saving')
  settle(result(true, false))
  await tick()
  expect(field('Author name').value).toBe('Edited while saving')
  expect(host!.textContent).toContain('Email: email refused')
  writeJson.mockResolvedValueOnce(result(true, true))
  button('Save identity').click()
  await tick()
  expect(JSON.parse((writeJson.mock.calls[1]![1] as { body: string }).body).name).toBe('Edited while saving')
})

it('does not let a late old-Node save clear the new scope or its pending edit', async () => {
  let settle!: (value: IdentityWriteResult) => void
  writeJson.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  draw()
  edit('Author name', 'Old Node draft')
  button('Save identity').click()
  setNode('node-b')
  await tick()
  edit('Author name', 'New Node draft')
  settle(result(true, true))
  await tick()
  expect(field('Author name').value).toBe('New Node draft')
  expect(button('Save identity')).toBeTruthy()
  expect(setQueryData).toHaveBeenCalledWith(['git-settings', 'node-a', 'project-a'], settings)
  expect(setQueryData).not.toHaveBeenCalledWith(['git-settings', 'node-b', 'project-a'], settings)
})

it('ignores a late response after disposal', async () => {
  let settle!: (value: IdentityWriteResult) => void
  writeJson.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  draw(); edit('Author name', 'Submitted'); button('Save identity').click()
  dispose(); dispose = () => {}
  settle(result(true, true))
  await tick()
  expect(setQueryData).toHaveBeenCalledWith(['git-settings', 'node-a', 'project-a'], settings)
})
