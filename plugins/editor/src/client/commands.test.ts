import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandExecutionContext, SearchCommand } from '@acorn/plugin-api/client'

const mocks = vi.hoisted(() => ({ files: vi.fn(), reveal: vi.fn(), entry: vi.fn(), folder: vi.fn(), nodeId: 'node-1' }))
vi.mock('./editorClient', () => ({ editorApi: () => ({ files: mocks.files }), editorApiForNode: (nodeId: string) => ({
  entry: (taskId: string, path: string) => mocks.entry(nodeId, taskId, path),
}) }))
vi.mock('./search/searchState', () => ({ findInFolder: mocks.folder }))
vi.mock('./editorState', () => ({ requestEditorReveal: mocks.reveal, activeFile: () => 'src/a.ts' }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  activeTaskId: () => 'task-1',
  activeNodeId: () => mocks.nodeId,
  focusedPane: () => 'editor',
}))

import { editorCommands } from './commands'
import { admitGraphicalEditor } from './editorAdmission'
import { registerEditorTreeFolders } from './editorTreeState'

// ⌘P, after it stopped being an overlay of its own. What is pinned is what the overlay's own test
// would have pinned if it had had one: the ranking is over the whole path, the row splits it for
// display only, the listing happens once per session, and picking a row shows the pane and opens an
// ephemeral tab.

const goTo = editorCommands.find((command) => command.id === 'editor.files.open') as SearchCommand
const goToLine = editorCommands.find((command) => command.id === 'editor.navigation.go-to-line') as SearchCommand
const folder = editorCommands.find((command) => command.id === 'editor.search.folder') as {
  when: (context?: CommandExecutionContext) => boolean
  run: (context: CommandExecutionContext) => Promise<void>
}

const context = (taskId: string): CommandExecutionContext => ({
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId: 'p-1', taskId, paneId: null, surfaceId: null,
})
const signal = (): AbortSignal => new AbortController().signal

describe('go to file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nodeId = 'node-1'
    mocks.files.mockResolvedValue(['src/client/App.tsx', 'src/node/boot.ts', 'README.md'])
  })

  it('is a task-scoped search gated on the editor plugin', () => {
    expect(goTo).toMatchObject({ kind: 'search', scope: 'task', palette: true, requires: { plugin: 'editor' } })
    // No debounce and no minimum: the list is already on this machine and an empty query is all of it.
    expect(goTo.debounceMs).toBe(0)
    expect(goTo.minQueryLength).toBe(0)
  })

  it('splits a path into the name and the directory that holds it', async () => {
    expect(await goTo.query('', context('task-1'), signal())).toEqual([
      { id: 'src/client/App.tsx', title: 'App.tsx', subtitle: 'src/client', ref: 'src/client/App.tsx' },
      { id: 'src/node/boot.ts', title: 'boot.ts', subtitle: 'src/node', ref: 'src/node/boot.ts' },
      // A file at the root has no directory to dim, so it carries no subtitle rather than an empty one.
      { id: 'README.md', title: 'README.md', ref: 'README.md' },
    ])
  })

  it('ranks over the whole path, so a query that spans the join still matches', async () => {
    // The reason this does not use `localSearch`: that adapter scores the title and the subtitle
    // separately, and neither half of `src/client/App.tsx` contains `client/App`.
    const rows = await goTo.query('client/App', context('task-1'), signal())
    expect(rows.map((row) => row.ref)).toEqual(['src/client/App.tsx'])
  })

  it('lists the worktree once per session, and again for the next one', async () => {
    const world = context('task-1')
    await goTo.query('', world, signal())
    await goTo.query('app', world, signal())
    await goTo.query('boot', world, signal())
    expect(mocks.files).toHaveBeenCalledTimes(1)
    expect(mocks.files).toHaveBeenCalledWith('task-1')

    await goTo.query('', context('task-2'), signal())
    expect(mocks.files).toHaveBeenCalledTimes(2)
    expect(mocks.files).toHaveBeenLastCalledWith('task-2')
  })

  it('asks again after a failed listing rather than replaying it', async () => {
    mocks.files.mockRejectedValueOnce(new Error('no worktree yet'))
    const world = context('task-1')
    await expect(goTo.query('', world, signal())).rejects.toThrow('no worktree yet')
    expect((await goTo.query('', world, signal())).length).toBe(3)
    expect(mocks.files).toHaveBeenCalledTimes(2)
  })

  it('retains a reveal for the chosen file', async () => {
    const world = context('task-1')
    const rows = await goTo.query('boot', world, signal())
    expect(goTo.select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.reveal).toHaveBeenCalledWith('task-1', 'src/node/boot.ts', 1, undefined)
  })

  it('keeps an exact colon filename and uses a numeric suffix only for a listed path', async () => {
    mocks.files.mockResolvedValue(['src/a.ts', 'src/a.ts:12', 'src/z.ts'])
    const world = context('task-1')
    const literal = await goTo.query('src/a.ts:12', world, signal())
    expect(literal.map((row) => row.ref)).toEqual(['src/a.ts:12'])
    goTo.select(literal[0], world)
    expect(mocks.reveal).toHaveBeenCalledWith('task-1', 'src/a.ts:12', 1, undefined)

    const positioned = await goTo.query('src/a.ts:200:4', world, signal())
    expect(positioned.map((row) => row.ref)).toEqual(['src/a.ts'])
    goTo.select(positioned[0], world)
    expect(mocks.reveal).toHaveBeenCalledWith('task-1', 'src/a.ts', 200, 4)
    expect((await goTo.query('src/a.ts:0', world, signal()))).toEqual([])
  })

  it('rejects a selection whose captured Node is no longer active', async () => {
    const world = { ...context('task-1'), nodeId: 'retired-node' }
    expect(await goTo.query('', world, signal())).toEqual([])
    expect(mocks.files).not.toHaveBeenCalled()
    goTo.select({ id: 'README.md', title: 'README.md', ref: 'README.md' }, world)
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it('accepts only positive line coordinates for a focused file jump', async () => {
    const world = context('task-1')
    expect(await goToLine.query('12:4', world, signal())).toEqual([])
    const release = admitGraphicalEditor('node-1', 'task-1', 'src/a.ts')
    expect(await goToLine.query('0:4', world, signal())).toEqual([])
    const rows = await goToLine.query('12:4', world, signal())
    goToLine.select(rows[0], world)
    expect(mocks.reveal).toHaveBeenCalledWith('task-1', 'src/a.ts', 12, 4)
    release()
    mocks.reveal.mockClear()
    goToLine.select(rows[0], world)
    expect(mocks.reveal).not.toHaveBeenCalled()
  })
})

describe('find in focused folder', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.nodeId = 'node-1'
    return registerEditorTreeFolders('task-1', 'node-1', (path) => path === 'src')
  })
  const treeContext = (): CommandExecutionContext => ({ ...context('task-1'), focusedCollection: { id: 'editor.file-tree:["node-1","task-1"]', key: 'src' } })

  it('requires a tree row captured by this task and routes its entry read to the captured Node', async () => {
    expect(folder.when(context('task-1'))).toBe(false)
    expect(folder.when({ ...treeContext(), focusedCollection: { ...treeContext().focusedCollection!, key: 'src/file.ts' } })).toBe(false)
    expect(folder.when({ ...treeContext(), taskId: 'previous-task' })).toBe(false)
    await folder.run({ ...treeContext(), focusedCollection: { id: 'editor.file-tree:["node-1","previous-task"]', key: 'src' } })
    expect(mocks.entry).not.toHaveBeenCalled()
    await folder.run(context('task-1'))
    expect(mocks.entry).not.toHaveBeenCalled()
    mocks.entry.mockResolvedValue({ kind: 'folder' })
    expect(folder.when(treeContext())).toBe(true)
    expect(folder.when({ ...treeContext(), host: 'tui' })).toBe(true)
    await folder.run(treeContext())
    expect(mocks.entry).toHaveBeenCalledWith('node-1', 'task-1', 'src')
    expect(mocks.folder).toHaveBeenCalledWith('task-1', 'src', 'node-1')
  })

  it('ignores files and an entry read that finishes after the Node changes', async () => {
    mocks.entry.mockResolvedValueOnce({ kind: 'file' })
    await folder.run(treeContext())
    expect(mocks.folder).not.toHaveBeenCalled()
    let finish!: (entry: { kind: 'folder' }) => void
    mocks.entry.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = folder.run(treeContext())
    mocks.nodeId = 'node-2'
    finish({ kind: 'folder' })
    await pending
    expect(mocks.folder).not.toHaveBeenCalled()
  })

  it('rejects late entry completion after the captured tree owner unmounts', async () => {
    const release = registerEditorTreeFolders('task-1', 'node-1', (path) => path === 'src')
    let finish!: (entry: { kind: 'folder' }) => void
    mocks.entry.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = folder.run(treeContext())
    release()
    finish({ kind: 'folder' })
    await pending
    expect(mocks.folder).not.toHaveBeenCalled()
    expect(folder.when(treeContext())).toBe(false)
  })
})
