import { createHash, webcrypto } from 'node:crypto'
import { createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import { EditorView } from '@codemirror/view'
import { clientEvents } from '@acorn/plugin-api/client'
import { setActiveNode } from '@acorn/plugin-api/testkit/client'
import type { EditorApi } from './editorClient'
import type { EditorReadResult } from '../contract/api'
import { createEditorController } from './editorController'
import { activeFile, openFiles } from './editorState'

// The controller without the pane: no tabs, tree, or status bar. A test gives it a box to mount
// CodeMirror in, then makes the same calls the pane makes. EditorPane.test.tsx covers the drawn pane.

// jsdom does no layout. CodeMirror measures ranges and scrolls elements, and both throw when missing.
Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

const revision = (text: string) => createHash('sha256').update(text).digest('hex')
const disk = new Map<string, string>()
const readDisk = async (_taskId: string, path: string): Promise<EditorReadResult> => {
  const text = disk.get(path)
  if (text === undefined) throw Object.assign(new Error(`No ${path}`), { status: 404, code: 'not_found' })
  return { text, revision: revision(text) }
}
const read = vi.fn(readDisk)
const api = {
  root: async () => '/worktree',
  fileStatus: async () => ({ kind: 'unavailable' }),
  entry: async (_taskId: string, path: string) => ({ root: '/worktree', path, kind: 'file', entryId: path }),
  lineMarkers: async () => null,
  read: (taskId: string, path: string) => read(taskId, path),
  write: async (_taskId: string, path: string, text: string) => {
    disk.set(path, text)
    return { ok: true, text, revision: revision(text) }
  },
} as unknown as EditorApi

let tasks = 0
const cleanups: (() => void)[] = []
beforeEach(() => {
  setActiveNode(null)
  vi.stubGlobal('crypto', webcrypto)
  disk.clear()
  disk.set('a.ts', 'const a = 1\n')
  disk.set('b.ts', 'const b = 2\n')
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  read.mockReset()
  read.mockImplementation(readDisk)
})

const start = () => {
  const taskId = `controller-${++tasks}`
  const box = document.createElement('div')
  document.body.append(box)
  const editor = createRoot((dispose) => {
    const controller = createEditorController({
      task: { id: taskId, projectId: 'p1' },
      api,
      queryClient: new QueryClient(),
      prefs: () => ({}),
    })
    controller.mountEditor(box)
    // The pane's wiring for the one intent this file needs: a history step arrives as a reveal.
    const off = clientEvents.on('presentation:pane-intent', ({ taskId: target, intent }) => {
      if (target === taskId && intent.kind === 'editor:reveal') controller.reveal(intent)
    })
    cleanups.push(() => {
      off()
      dispose()
      box.remove()
    })
    return controller
  })
  const view = () => {
    const dom = box.querySelector<HTMLElement>('.cm-editor')
    const found = dom && EditorView.findFromDOM(dom)
    if (!found) throw new Error('no editor yet')
    return found
  }
  const showing = (text: string) => vi.waitFor(() => expect(view().state.doc.toString()).toBe(text))
  return { taskId, editor, view, showing }
}

describe('the editor controller', () => {
  it('opens a file, saves an edit, and clears the dirty mark', async () => {
    const { taskId, editor, view, showing } = start()
    editor.openPath('a.ts', false)
    await showing('const a = 1\n')
    view().dispatch({ changes: { from: 0, insert: '// edited\n' } })
    expect(openFiles(taskId)[0]?.dirty).toBe(true)
    expect(await editor.save('a.ts')).toBe(true)
    expect(disk.get('a.ts')).toBe('// edited\nconst a = 1\n')
    expect(openFiles(taskId)[0]?.dirty).toBe(false)
  })

  it('replaces a clean document from disk, and holds a draft until a confirmed reload', async () => {
    const { editor, view, showing } = start()
    editor.openPath('a.ts', false)
    await showing('const a = 1\n')
    disk.set('a.ts', 'const a = 2\n')
    await editor.revalidate('a.ts')
    expect(view().state.doc.toString()).toBe('const a = 2\n')

    view().dispatch({ changes: { from: 0, insert: 'draft ' } })
    disk.set('a.ts', 'const a = 3\n')
    await editor.revalidate('a.ts')
    expect(editor.diskState()).toBe('changed')
    expect(view().state.doc.toString()).toBe('draft const a = 2\n')

    editor.armDecision('reload')
    editor.confirmDecision('reload')
    await showing('const a = 3\n')
    expect(editor.diskState()).toBe(null)
  })

  it('steps back and forward through the files it opened', async () => {
    const { taskId, editor, showing } = start()
    editor.openPath('a.ts', false)
    await showing('const a = 1\n')
    editor.openPath('b.ts', false)
    await showing('const b = 2\n')
    await editor.replay(-1)
    expect(activeFile(taskId)).toBe('a.ts')
    await showing('const a = 1\n')
    await editor.replay(1)
    expect(activeFile(taskId)).toBe('b.ts')
    await showing('const b = 2\n')
  })

  // Opening the file already on screen leaves history alone, so only the aborted signal stops the
  // older step.
  it('drops a back step whose read finishes after a newer navigation', async () => {
    const { taskId, editor, showing } = start()
    editor.openPath('a.ts', false)
    await showing('const a = 1\n')
    editor.openPath('b.ts', false)
    await showing('const b = 2\n')
    let finishBack!: () => void
    read.mockImplementationOnce(async (taskId, path) => {
      await new Promise<void>((resolve) => {
        finishBack = resolve
      })
      return readDisk(taskId, path)
    })
    const back = editor.replay(-1)
    await vi.waitFor(() => expect(finishBack).toBeTypeOf('function'))
    editor.openPath('b.ts', false)
    finishBack()
    await back
    expect(activeFile(taskId)).toBe('b.ts')
    await showing('const b = 2\n')
  })
})
