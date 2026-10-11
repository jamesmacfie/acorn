import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { ConflictDetail } from '../shared/api'

const [detail, setDetail] = createSignal<ConflictDetail | undefined>()
const writeJson = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const invalidateQueries = vi.fn()
let typed: ((text: string) => void) | undefined
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ get data() { return detail() }, error: null, isLoading: false }),
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries }),
}))
vi.mock('@acorn/plugin-api/client', () => ({ activeNodeId: () => 'node', nodeReady: () => true, openPane: vi.fn(), readJson: vi.fn(), writeJson }))
// The custody owner is real; only CodeMirror is replaced by a box that reports typing.
vi.mock('@acorn/plugin-api/ui/editor', async (original) => ({
  ...await original<typeof import('@acorn/plugin-api/ui/editor')>(),
  mountEmbeddedEditor: (_: HTMLElement, options: { onChange: (text: string) => void }) => {
    typed = options.onChange
    return { read: () => '', write: (text: string) => options.onChange(text), destroy: () => {} }
  },
}))

const { ConflictResolver } = await import('./ConflictResolver')
const { documentCustody } = await import('@acorn/plugin-api/ui/editor')
const task = { id: 'task', projectId: 'project', title: 'Task' } as Parameters<typeof ConflictResolver>[0]['task']
const conflict = (patch: Partial<ConflictDetail> = {}): ConflictDetail => ({
  path: 'shared', operation: 'merge', fingerprint: 'f'.repeat(64), unsupported: null,
  sides: [{ stage: 1, label: 'Common ancestor', present: true, objectId: 'a', mode: '100644', text: 'base\n' },
    { stage: 2, label: 'Task (HEAD)', present: true, objectId: 'b', mode: '100644', text: 'main\n' },
    { stage: 3, label: 'Merging feature', present: false, objectId: null, mode: null, text: null }],
  result: { present: true, revision: 'r1', text: '<<<<<<< HEAD\nmain\n>>>>>>> feature\n' }, ...patch,
})
let host: HTMLElement | null = null
let dispose = () => {}
const onClose = vi.fn()
afterEach(() => {
  // Custody is a module registry, so each test leaves the address clean and unheld.
  const custody = documentCustody(['node', 'file', 'task', 'shared'], ''); custody.reload(''); custody.retain()()
  dispose(); host?.remove(); host = null; localStorage.clear(); writeJson.mockReset(); onClose.mockReset(); invalidateQueries.mockReset()
})
const draw = () => { host = document.createElement('div'); document.body.append(host); dispose = render(() => <ConflictResolver task={task} path="shared" checkout="/checkout" onClose={onClose} />, host) }
const button = (label: string) => [...host!.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label)
const sent = () => JSON.parse((writeJson.mock.calls.at(-1)![1] as { body: string }).body)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

it('takes a side into the shared Editor draft, saves it with the read fingerprint, and acknowledges it', async () => {
  setDetail(conflict())
  draw()
  expect(host!.textContent).toContain('Task (HEAD)')
  button('Use ours')!.click()
  const custody = documentCustody(['node', 'file', 'task', 'shared'], '')
  expect(custody.current.toString()).toBe('main\n')
  writeJson.mockResolvedValueOnce({ ok: true, saved: true, error: null, revision: 'r2', state: null })
  button('Save and stage')!.click()
  await settle()
  expect(sent()).toEqual({ expectedPath: '/checkout', path: 'shared', fingerprint: 'f'.repeat(64), resolution: { kind: 'text', text: 'main\n' } })
  expect(custody).toMatchObject({ dirty: false, acknowledgedRevision: 'r2' })
  expect(onClose).toHaveBeenCalled()
})

it('refuses to save over typing that happened in Editor after this view last edited', async () => {
  setDetail(conflict())
  draw()
  typed!('mine\n')
  documentCustody(['node', 'file', 'task', 'shared'], '').editText('typed in Editor\n')
  button('Save and stage')!.click()
  await settle()
  expect(writeJson).not.toHaveBeenCalled()
  expect(host!.textContent).toContain('The draft changed in Editor')
})

it('blocks an Editor draft made against another version until it is discarded', async () => {
  const custody = documentCustody(['node', 'file', 'task', 'shared'], 'old\n', 'r0')
  custody.editText('unsaved\n')
  setDetail(conflict())
  draw()
  expect(host!.textContent).toContain('Editor has unsaved changes')
  expect(button('Save and stage')).toBeUndefined()
  button('Discard draft')!.click()
  button('Discard the unsaved draft?')!.click()
  expect(custody).toMatchObject({ dirty: false, acknowledgedRevision: 'r1' })
  expect(button('Save and stage')).toBeDefined()
})

it('keeps a saved but unstaged result acknowledged and asks to retry after a reload', async () => {
  setDetail(conflict())
  draw()
  typed!('both\n')
  writeJson.mockResolvedValueOnce({ ok: false, saved: true, error: 'Saved, but not staged: index.lock exists', revision: 'r2', state: null })
  button('Save and stage')!.click()
  await settle()
  expect(documentCustody(['node', 'file', 'task', 'shared'], '')).toMatchObject({ dirty: false, acknowledgedRevision: 'r2' })
  expect(host!.textContent).toContain('Press Save and stage to retry')
  expect(invalidateQueries).toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

it('takes a missing side as a confirmed deletion, and shows guidance for unsupported input', async () => {
  setDetail(conflict())
  draw()
  expect(host!.textContent).toContain('Theirs: Merging feature deleted this file.')
  expect(button('Use theirs')).toBeUndefined()
  writeJson.mockResolvedValueOnce({ ok: true, saved: true, error: null, revision: null, state: null })
  button('Take deletion')!.click()
  button('Delete shared and stage it? The result draft is discarded.')!.click()
  await settle()
  expect(sent().resolution).toEqual({ kind: 'delete' })
  dispose(); host!.remove()
  setDetail(conflict({ unsupported: 'Merging feature is binary or not UTF-8 text. Resolve it in a terminal.' }))
  draw()
  expect(host!.textContent).toContain('Resolve it in a terminal')
  expect(button('Save and stage')).toBeUndefined()
})
