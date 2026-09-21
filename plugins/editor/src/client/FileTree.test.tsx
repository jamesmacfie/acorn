import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorEntry } from './editorClient'
import { evictEditorTreeState, setEditorTreeDirectoryOpen } from './editorTreeState'

const listing = vi.fn(async (_taskId: string, path: string): Promise<EditorEntry[]> => {
  if (path === '') return [{ name: 'src', dir: true }]
  if (path === 'src') return [{ name: 'nested', dir: true }, { name: 'app.ts', dir: false }]
  if (path === 'src/nested') return [{ name: 'model.ts', dir: false }]
  return []
})

vi.mock('./editorClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./editorClient')>()),
  editorApi: () => ({ list: listing }),
}))

const { default: FileTree } = await import('./FileTree')

let dispose: (() => void) | undefined
let host: HTMLElement
const taskId = 'file-tree-test'

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  listing.mockClear()
  evictEditorTreeState(taskId)
})

const mount = (onOpen = vi.fn()) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <FileTree
      taskId={taskId}
      openPath={null}
      reveal={null}
      onOpen={onOpen}
      onRevealed={() => {}}
    />
  ), host)
  return onOpen
}

describe('the editor file tree', () => {
  it('reloads retained expanded branches when the tree mounts again', async () => {
    setEditorTreeDirectoryOpen(taskId, 'src', true)
    setEditorTreeDirectoryOpen(taskId, 'src/nested', true)
    mount()

    await vi.waitFor(() => expect(host.textContent).toContain('model.ts'))
    expect(listing.mock.calls.map(([, path]) => path)).toEqual(['', 'src', 'src/nested'])
    expect(host.querySelector<HTMLElement>('[title="src"] [aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector<HTMLElement>('[title="src/nested"] [aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens a file as a preview on one click and keeps it on double-click', async () => {
    setEditorTreeDirectoryOpen(taskId, 'src', true)
    const onOpen = mount()
    const file = await vi.waitFor(() => {
      const row = host.querySelector<HTMLElement>('[title="src/app.ts"]')
      if (!row) throw new Error('file row not loaded')
      return row
    })

    file.click()
    expect(onOpen).toHaveBeenLastCalledWith('src/app.ts', true)

    file.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(onOpen).toHaveBeenLastCalledWith('src/app.ts', false)
  })
})
