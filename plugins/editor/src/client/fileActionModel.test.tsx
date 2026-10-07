import { EditorState } from '@codemirror/state'
import { afterEach, expect, it, vi } from 'vitest'
import { documentCustody, fileDocumentCustodies } from '@acorn/plugin-api/ui/editor'
import { setActiveNode } from '@acorn/plugin-api/testkit/client'
import type { EditorApi } from './editorClient'
import type { FileTarget } from '../contract/api'
import { createFileActionModel } from './fileActionModel'
import { flushEditorDocument, type EditorPool } from './editorDocumentPool'
import { activeFile, editorOpen, editorSetDirty, evictEditorState, openFiles, type TaskEditorState } from './editorState'
import { editorTreeDirectoryOpen, setEditorTreeDirectoryOpen } from './editorTreeState'
import { editorViewState, rememberEditorViewState } from './editorViewState'

let serial = 0
const task = () => `file-actions-${++serial}`
const target = (path: string, kind: 'file' | 'folder' = 'file', identity = 'ctime-1', entryId = 'inode-1'): FileTarget =>
  ({ root: '/work', path, kind, identity, entryId })
const pool = (): EditorPool => ({ retired: false, files: new Map(), saved: new Map(), reading: new Map(), externalEditors: new Set() })
const api = (overrides: Partial<EditorApi> = {}): EditorApi => ({
  root: async () => '/work', list: async () => [], files: async () => [], read: async () => ({ text: '', revision: 'rev0' }),
  readImage: async () => ({ bytes: new Uint8Array(), type: 'image/png' }), lineMarkers: async () => null,
  fileStatus: async () => ({ kind: 'unavailable' }),
  write: async (_task, _path, text) => ({ ok: true, text, revision: 'rev1' }), entry: async (_task, path) => target(path),
  trashAvailability: async () => ({ available: true }), renameAvailability: async () => ({ available: true }), create: async () => ({ ok: true, path: 'new.ts' }),
  rename: async () => ({ ok: true, path: 'renamed' }), trash: async () => ({ ok: true, path: 'gone' }),
  ...overrides,
})
const recoveryKey = (taskId: string, path: string, node: string | null = null) =>
  `acorn.document.recovery.${JSON.stringify([node, 'file', taskId, path])}`

afterEach(() => { localStorage.clear(); setActiveNode(null) })

it('holds old writers through a delayed folder rename, menu dismissal, and pane retirement', async () => {
  const taskId = task()
  const custody = documentCustody([null, 'file', taskId, 'dir/a.ts'], 'base', 'rev0')
  custody.editText('draft')
  custody.state = EditorState.create({ doc: 'draft' })
  const stateBeforeRename = custody.state
  custody.viewState = { anchor: 2, head: 2, scrollTop: 31 }
  custody.flushRecovery()
  const owner = pool()
  const release = custody.retain()
  owner.files.set('dir/a.ts', { custody, state: custody.state, release, language: [], mount: {}, markersReadAt: 0, markersGeneration: 0 })
  editorOpen(taskId, 'dir/a.ts', true)
  editorSetDirty(taskId, 'dir/a.ts', true)
  editorOpen(taskId, 'dir/preview.ts', true)
  let finish!: (value: { ok: true; path: string }) => void
  const rename = vi.fn(() => new Promise<{ ok: true; path: string }>((resolve) => { finish = resolve }))
  const write = vi.fn(async (_task: string, _path: string, text: string) => ({ ok: true as const, text, revision: 'rev1' }))
  const service = api({ rename, write })
  const model = createFileActionModel(service, owner, taskId, null, () => {}, async (state) => {
    expect(state.files.map((file) => file.path)).toEqual(['moved/a.ts', 'moved/preview.ts'])
  })
  const armed = model.arm(target('dir', 'folder'))
  const end = armed.hold()
  const pending = model.rename(armed, 'moved')
  armed.release() // closing the menu does not release the operation's suspension
  await vi.waitFor(() => expect(rename).toHaveBeenCalledOnce())
  expect(() => documentCustody([null, 'file', taskId, 'moved/a.ts'], 'external')).toThrow('Wait for it to finish')
  custody.editText('later typing')
  await flushEditorDocument(custody, service, taskId, 'dir/a.ts')
  expect(write).not.toHaveBeenCalled()
  owner.retired = true
  owner.files.clear()
  finish({ ok: true, path: 'moved' })
  await pending
  end()
  expect(custody.current.toString()).toBe('later typing')
  expect(custody.state).toBe(stateBeforeRename) // the complete CodeMirror state, including undo, survives
  expect(custody.viewState).toEqual({ anchor: 2, head: 2, scrollTop: 31 })
  expect(custody.ownsFile(taskId, 'dir/a.ts')).toBe(false)
  expect(custody.ownsFile(taskId, 'moved/a.ts')).toBe(true)
  expect(localStorage.getItem(recoveryKey(taskId, 'dir/a.ts'))).toBeNull()
  expect(localStorage.getItem(recoveryKey(taskId, 'moved/a.ts'))).toContain('later typing')
  expect(openFiles(taskId).map((file) => file.path)).toEqual(['moved/a.ts', 'moved/preview.ts'])
  expect(activeFile(taskId)).toBe('moved/preview.ts')
  expect(openFiles(taskId)[0]).toMatchObject({ dirty: true, ephemeral: false })
  expect(openFiles(taskId)[1]).toMatchObject({ dirty: false, ephemeral: true })
  await flushEditorDocument(custody, service, taskId, 'dir/a.ts') // an old pane closure is inert
  expect(write).not.toHaveBeenCalled()
  evictEditorState(taskId)
})

it('enumerates closed persisted drafts and moves their recovery without touching another Node', async () => {
  const taskId = task()
  const stored = { text: 'closed draft', acknowledged: 'disk', acknowledgedRevision: 'rev0' }
  localStorage.setItem(recoveryKey(taskId, 'dir/closed.ts'), JSON.stringify(stored))
  localStorage.setItem(recoveryKey(taskId, 'dir/other.ts', 'other-node'), JSON.stringify(stored))
  const found = fileDocumentCustodies(null, taskId, 'dir')
  expect([...found.keys()]).toEqual(['dir/closed.ts'])
  const model = createFileActionModel(api({ rename: async () => ({ ok: true, path: 'moved' }) }), pool(), taskId, null, () => {})
  const armed = model.arm(target('dir', 'folder'))
  const end = armed.hold()
  await model.rename(armed, 'moved')
  armed.release(); end()
  expect(localStorage.getItem(recoveryKey(taskId, 'moved/closed.ts'))).toContain('closed draft')
  expect(localStorage.getItem(recoveryKey(taskId, 'dir/closed.ts'))).toBeNull()
  expect(localStorage.getItem(recoveryKey(taskId, 'dir/other.ts', 'other-node'))).toContain('closed draft')
})

it('holds a document acquired after the menu arm until its folder move is reconciled', async () => {
  const taskId = task()
  let finish!: (result: { ok: true; path: string }) => void
  const rename = vi.fn(() => new Promise<{ ok: true; path: string }>((resolve) => { finish = resolve }))
  const write = vi.fn(async (_task: string, _path: string, text: string) => ({ ok: true as const, text, revision: 'rev1' }))
  const service = api({ rename, write })
  const model = createFileActionModel(service, pool(), taskId, null, () => {})
  const armed = model.arm(target('dir', 'folder'))
  // A read that began before the menu opened can still hand its document to the pane afterward.
  const late = documentCustody([null, 'file', taskId, 'dir/late.ts'], 'disk', 'rev0')
  const release = late.retain()
  late.editText('typed after arm')
  await flushEditorDocument(late, service, taskId, 'dir/late.ts')
  expect(write).not.toHaveBeenCalled()
  const end = armed.hold()
  const pending = model.rename(armed, 'moved')
  armed.release()
  await vi.waitFor(() => expect(rename).toHaveBeenCalledOnce())
  finish({ ok: true, path: 'moved' })
  await pending
  end()
  expect(late.ownsFile(taskId, 'moved/late.ts')).toBe(true)
  await flushEditorDocument(late, service, taskId, 'dir/late.ts')
  expect(write).not.toHaveBeenCalled()
  expect(localStorage.getItem(recoveryKey(taskId, 'moved/late.ts'))).toContain('typed after arm')
  release()
})

it('moves captured custody after a Node switch without writing to the former path', async () => {
  const taskId = task()
  const custody = documentCustody([null, 'file', taskId, 'before.ts'], 'disk', 'rev0')
  custody.editText('unsaved')
  custody.flushRecovery()
  let finish!: (result: { ok: true; path: string }) => void
  const rename = vi.fn(() => new Promise<{ ok: true; path: string }>((resolve) => { finish = resolve }))
  const write = vi.fn(async () => ({ ok: true as const, text: 'should not write', revision: 'rev1' }))
  const service = api({ rename, write })
  editorOpen(taskId, 'before.ts', false)
  setEditorTreeDirectoryOpen(taskId, 'before.ts', true, null)
  rememberEditorViewState(taskId, 'before.ts', { anchor: 1, head: 1, scrollTop: 7 }, null)
  let firstNodeTabs: TaskEditorState | undefined
  const model = createFileActionModel(service, pool(), taskId, null, () => {}, async (state) => { firstNodeTabs = state })
  const armed = model.arm(target('before.ts'))
  const end = armed.hold()
  const pending = model.rename(armed, 'after.ts')
  await vi.waitFor(() => expect(rename).toHaveBeenCalledOnce())
  setActiveNode('other-node')
  evictEditorState(taskId)
  editorOpen(taskId, 'other-node.ts', false)
  setEditorTreeDirectoryOpen(taskId, 'before.ts', true, 'other-node')
  rememberEditorViewState(taskId, 'before.ts', { anchor: 8, head: 8, scrollTop: 0 }, 'other-node')
  armed.release()
  finish({ ok: true, path: 'after.ts' })
  await pending
  end()
  expect(custody.ownsFile(taskId, 'after.ts')).toBe(true)
  expect(firstNodeTabs?.files.map((file) => file.path)).toEqual(['after.ts'])
  expect(firstNodeTabs?.active).toBe('after.ts')
  expect(openFiles(taskId).map((file) => file.path)).toEqual(['other-node.ts'])
  expect(editorTreeDirectoryOpen(taskId, 'after.ts', null)).toBe(true)
  expect(editorTreeDirectoryOpen(taskId, 'before.ts', 'other-node')).toBe(true)
  expect(editorViewState(taskId, 'after.ts', null)?.scrollTop).toBe(7)
  expect(editorViewState(taskId, 'before.ts', 'other-node')?.anchor).toBe(8)
  expect(localStorage.getItem(recoveryKey(taskId, 'before.ts'))).toBeNull()
  expect(localStorage.getItem(recoveryKey(taskId, 'after.ts'))).toContain('unsaved')
  await flushEditorDocument(custody, service, taskId, 'before.ts')
  expect(write).not.toHaveBeenCalled()
})

it('retires captured tabs after trash succeeds on the previous Node with the same task ID', async () => {
  const taskId = task()
  const custody = documentCustody([null, 'file', taskId, 'doomed.ts'], 'disk', 'rev0')
  const releaseCustody = custody.retain()
  editorOpen(taskId, 'doomed.ts', false)
  let finish!: (result: { ok: true; path: string }) => void
  const trash = vi.fn(() => new Promise<{ ok: true; path: string }>((resolve) => { finish = resolve }))
  let firstNodeTabs: TaskEditorState | undefined
  const model = createFileActionModel(api({ trash }), pool(), taskId, null, () => {}, async (state) => { firstNodeTabs = state })
  const armed = model.arm(target('doomed.ts'))
  const end = armed.hold()
  const pending = model.trash(armed, false)
  await vi.waitFor(() => expect(trash).toHaveBeenCalledOnce())
  setActiveNode('other-node')
  evictEditorState(taskId)
  editorOpen(taskId, 'safe.ts', false)
  finish({ ok: true, path: 'doomed.ts' })
  await pending
  armed.release(); end()
  expect(firstNodeTabs).toEqual({ files: [], active: null })
  expect(openFiles(taskId).map((file) => file.path)).toEqual(['safe.ts'])
  expect(custody.ownsFile(taskId, 'doomed.ts')).toBe(false)
  releaseCustody()
})

it('refuses a destination draft before Node mutation', async () => {
  const taskId = task()
  localStorage.setItem(recoveryKey(taskId, 'new.ts'), JSON.stringify({ text: 'mine', acknowledged: '' }))
  const rename = vi.fn(async () => ({ ok: true as const, path: 'new.ts' }))
  const model = createFileActionModel(api({ rename }), pool(), taskId, null, () => {})
  const armed = model.arm(target('old.ts'))
  await expect(model.rename(armed, 'new.ts')).rejects.toThrow('destination document')
  expect(rename).not.toHaveBeenCalled()
  armed.release()
})

it('refreshes an admitted save for rename but rejects a same-kind replacement after a trash save', async () => {
  const taskId = task()
  const custody = documentCustody([null, 'file', taskId, 'old.ts'], 'disk', 'rev0')
  custody.editText('draft')
  let finishWrite!: (result: { ok: true; text: string; revision: string }) => void
  const write = vi.fn(() => new Promise<{ ok: true; text: string; revision: string }>((resolve) => { finishWrite = resolve }))
  const fresh = target('old.ts', 'file', 'ctime-2')
  const entry = vi.fn(async () => fresh)
  const rename = vi.fn(async () => ({ ok: true as const, path: 'new.ts' }))
  const service = api({ write, entry, rename })
  const saving = flushEditorDocument(custody, service, taskId, 'old.ts')
  const model = createFileActionModel(service, pool(), taskId, null, () => {})
  const armed = model.arm(target('old.ts'))
  const end = armed.hold()
  finishWrite({ ok: true, text: 'draft', revision: 'rev1' })
  await saving
  await model.rename(armed, 'new.ts')
  expect(rename).toHaveBeenCalledWith(taskId, fresh, 'new.ts')
  armed.release(); end()

  const next = documentCustody([null, 'file', taskId, 'trash.ts'], 'disk', 'rev0')
  next.editText('to save')
  const trash = vi.fn(async () => ({ ok: true as const, path: 'trash.ts' }))
  const replacement = api({ entry: async () => target('trash.ts', 'file', 'ctime-replaced', 'different-inode'), trash })
  const second = createFileActionModel(replacement, pool(), taskId, null, () => {})
  const captured = second.arm(target('trash.ts'))
  const endSecond = captured.hold()
  await expect(second.trash(captured, true)).rejects.toThrow('tree entry changed')
  expect(trash).not.toHaveBeenCalled()
  expect(next.current.toString()).toBe('to save')
  captured.release(); endSecond()
})

it('keeps closed dirty recovery on a failed save, then retires all descendants after explicit saves', async () => {
  const taskId = task()
  localStorage.setItem(recoveryKey(taskId, 'dir/closed.ts'), JSON.stringify({ text: 'draft', acknowledged: 'disk', acknowledgedRevision: 'rev0' }))
  const open = documentCustody([null, 'file', taskId, 'dir/open.ts'], 'disk', 'rev0')
  open.editText('open draft')
  open.flushRecovery()
  editorOpen(taskId, 'dir/open.ts', false)
  const trash = vi.fn(async () => ({ ok: true as const, path: 'dir' }))
  const write = vi.fn().mockResolvedValueOnce({ ok: false as const, kind: 'failure' as const, reason: 'disk full' })
    .mockImplementation(async (_task: string, _path: string, text: string) => ({ ok: true as const, text, revision: 'rev1' }))
  const service = api({ write, trash, entry: async () => target('dir', 'folder', 'ctime-2') })
  const model = createFileActionModel(service, pool(), taskId, null, () => {})
  const first = model.arm(target('dir', 'folder'))
  const endFirst = first.hold()
  await expect(model.trash(first, true)).rejects.toThrow('disk full')
  expect(trash).not.toHaveBeenCalled()
  expect(localStorage.getItem(recoveryKey(taskId, 'dir/closed.ts'))).toContain('draft')
  first.release(); endFirst()

  const second = model.arm(target('dir', 'folder'))
  const endSecond = second.hold()
  await model.trash(second, true)
  second.release(); endSecond()
  expect(trash).toHaveBeenCalledOnce()
  expect(localStorage.getItem(recoveryKey(taskId, 'dir/closed.ts'))).toBeNull()
  expect(localStorage.getItem(recoveryKey(taskId, 'dir/open.ts'))).toBeNull()
  expect(openFiles(taskId)).toEqual([])
  await flushEditorDocument(open, service, taskId, 'dir/open.ts')
  expect(write).toHaveBeenCalledTimes(3)
  evictEditorState(taskId)
})

it('blocks an edit made while the Node is moving a file to trash', async () => {
  const taskId = task()
  const custody = documentCustody([null, 'file', taskId, 'doomed.ts'], 'disk', 'rev0')
  const releaseCustody = custody.retain()
  let finish!: (result: { ok: true; path: string }) => void
  const trash = vi.fn(() => new Promise<{ ok: true; path: string }>((resolve) => { finish = resolve }))
  const write = vi.fn(async (_task: string, _path: string, text: string) => ({ ok: true as const, text, revision: 'rev1' }))
  const service = api({ trash, write })
  const model = createFileActionModel(service, pool(), taskId, null, () => {})
  const armed = model.arm(target('doomed.ts'))
  const end = armed.hold()
  const pending = model.trash(armed, false)
  await vi.waitFor(() => expect(trash).toHaveBeenCalledOnce())
  armed.release()
  custody.editText('typed during trash')
  await flushEditorDocument(custody, service, taskId, 'doomed.ts')
  expect(write).not.toHaveBeenCalled()
  finish({ ok: true, path: 'doomed.ts' })
  await expect(pending).rejects.toThrow('local recovery could not finish')
  end()
  expect(custody.current.toString()).toBe('typed during trash')
  expect(custody.writeBlock).toContain('actual path')
  expect(localStorage.getItem(recoveryKey(taskId, 'doomed.ts'))).toContain('typed during trash')
  await expect(flushEditorDocument(custody, service, taskId, 'doomed.ts')).rejects.toThrow('actual path')
  expect(write).not.toHaveBeenCalled()
  releaseCustody()
})
