import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { SCRATCH_SELECT_ID } from '../shared/database'
import type { DbSavedQuery } from '../shared/database'
import { DatabasePaneApp } from './app'

// What the palette's two rows do once they reach this pane, driven the way the sandbox drives it.
//
// One property carries both, and it is the one phase 5 asks for by name: picking a row LOADS SQL and
// never runs it (docs/database/palette-and-workflows.md § From the command palette). Running is
// the reader's next keystroke, and the pane already has a chord and a button for it.
//
// Two ids arrive on the same selection channel, because they are two different questions. A saved
// query's own id loads that query. `#scratch` is the sentinel the `Generate SQL` route answers with:
// it wrote the document on the node, and a pane that was already open has the old text in its editor.

const queries: DbSavedQuery[] = [
  { id: 'q-1', name: 'paid orders', notes: 'excludes refunds', sql: 'SELECT 1;', updatedAt: 0 },
  { id: 'q-2', name: 'signups', notes: null, sql: 'SELECT 2;', updatedAt: 0 },
]

const runQuery = vi.fn()
const updateCell = vi.fn(async () => ({ ok: true, rowCount: 1 }))
const connectDb = vi.fn(async () => ({ ok: true, database: 'dev' }))
const listRows = vi.fn(async () => ({ columns: ['id', 'name'], rows: [['1', 'Account']], rowCount: 1, command: 'SELECT', total: 1 }))
let taskId = 'task-1'
let taskSequence = 0
const states = new Map<string, unknown>()
const readScratch = vi.fn(async () => 'SELECT generated;')
const flush = vi.fn(async () => {})
const read = vi.fn(async () => '')
let saved: () => Promise<DbSavedQuery[]> = async () => queries

vi.mock('./databaseClient', () => ({ createDatabaseClient: () => ({
  connectDb: () => connectDb(),
  disconnectDb: async () => ({ ok: true }),
  listTables: async () => ({ tables: [{ schema: 'public', name: 'accounts' }, { schema: 'public', name: 'users' }] }),
  listColumns: async () => ({ columns: [{ name: 'id', dataType: 'integer', nullable: false, isPk: true }, { name: 'name', dataType: 'text', nullable: true, isPk: false }] }),
  listRows: () => listRows(),
  listSavedQueries: () => saved(),
  listModelBackends: async () => [],
  deleteSavedQuery: async () => {},
  updateCell: (...args: unknown[]) => (updateCell as (...args: unknown[]) => Promise<unknown>)(...args),
  insertRow: async () => ({ ok: true, rowCount: 1 }),
  deleteRow: async () => ({ ok: true, rowCount: 1 }),
  readScratch: () => readScratch(),
  runQuery: (...args: unknown[]) => runQuery(...args),
}) }))

const settle = async () => {
  for (let at = 0; at < 4; at++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

type TreeNode = ReturnType<typeof createRemoteRoot>['node']
type Harness = { nodes: () => TreeNode[]; written: string[]; select: (item: string) => void; execute: () => void; pressExecute: () => void; text: () => string; dispose: () => void }

const mount = (item?: string, scope: { nodeId?: string; taskId?: string; render?: ReturnType<typeof solidTree> } = {}): Harness => {
  const ops: TreeMutation[] = []
  const root = createRemoteRoot((batch) => ops.push(...batch))
  const written: string[] = []
  let onAction: (command: string) => void = () => {}
  let onSelect: (item: string) => void = () => {}
  const bridge = {
    context: { surface: 'database', target: 'remote', nodeId: scope.nodeId ?? 'node-a', ...(item ? { item } : {}) },
    state: {
      get: async (key: string) => states.get(`${scope.nodeId ?? 'node-a'}:${key}`) ?? null,
      set: async (key: string, value: unknown) => { states.set(`${scope.nodeId ?? 'node-a'}:${key}`, structuredClone(value)) },
    },
    document: {
      read: () => read(),
      write: async (text: string) => void written.push(text),
      flush: () => flush(),
    },
    onSelect: (handler: (item: string) => void) => {
      onSelect = handler
      return () => {}
    },
    onSurfaceAction: (handler: (command: string) => void) => { onAction = handler; return () => {} },
  } as unknown as AcornBridge
  let unmount = () => {}
  ;(scope.render ?? solidTree(DatabasePaneApp))(bridge, {
    entry: 'panel',
    root,
    props: () => ({ taskId: scope.taskId ?? taskId }),
    onProps: () => {},
    onUnmount: (dispose) => { unmount = dispose },
    // This tree asks its host for nothing, so both throw: a fixture that silently answered
    // would hide a component that started asking.
    host: {
      invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
      openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
    },
  })
  const nodes = () => {
    const all: TreeNode[] = []
    const visit = (node: TreeNode) => { all.push(node); node.children.forEach(visit) }
    root.node.children.forEach(visit)
    return all
  }
  const pressExecute = () => {
    const button = nodes().find((node) => node.type === 'Button' && node.children.some((child) => child.props.value === 'Run'))
    if (!button) throw new Error('Run button missing')
    ;(button.props.onPress as () => void)()
  }
  const text = () => {
    const visit = (node: typeof root.node): string => String(node.props.value ?? '') + node.children.map(visit).join('')
    return visit(root.node)
  }
  return { nodes, written, text, select: (next) => onSelect(next), execute: () => onAction('execute'), pressExecute, dispose: () => { unmount(); root.dispose() } }
}

beforeEach(() => {
    taskId = `task-${++taskSequence}`
    connectDb.mockReset().mockResolvedValue({ ok: true, database: 'dev' })
    listRows.mockReset().mockResolvedValue({ columns: ['id', 'name'], rows: [['1', 'Account']], rowCount: 1, command: 'SELECT', total: 1 })
    updateCell.mockClear()
    runQuery.mockReset()
    readScratch.mockReset().mockResolvedValue('SELECT generated;')
    flush.mockReset().mockResolvedValue(undefined)
    read.mockReset().mockResolvedValue('')
    saved = async () => queries
  })

describe('what the palette hands the Database pane', () => {
  it('loads a saved query’s SQL into the editor and does not run it', async () => {
    const pane = mount()
    await settle()
    pane.select('q-2')
    await settle()
    expect(pane.written).toEqual(['SELECT 2;'])
    expect(runQuery).not.toHaveBeenCalled()
    pane.dispose()
  })

  it('applies the selection that opened the pane, once the list it names has landed', async () => {
    // The row and the list are two round trips racing each other, and the row usually wins.
    let land: (rows: DbSavedQuery[]) => void = () => {}
    saved = () => new Promise((resolve) => { land = resolve })
    const pane = mount('q-1')
    await settle()
    expect(pane.written).toEqual([])
    land(queries)
    await settle()
    expect(pane.written).toEqual(['SELECT 1;'])
    expect(runQuery).not.toHaveBeenCalled()
    pane.dispose()
  })

  it('re-reads the scratch document on the generate sentinel, rather than looking for a saved query', async () => {
    const pane = mount()
    await settle()
    pane.select(SCRATCH_SELECT_ID)
    await settle()
    expect(readScratch).toHaveBeenCalledTimes(1)
    expect(pane.written).toEqual(['SELECT generated;'])
    // Loading generated SQL is not running it either.
    expect(runQuery).not.toHaveBeenCalled()
    pane.dispose()
  })

  it('ignores an id that names neither a saved query nor the scratch document', async () => {
    const pane = mount()
    await settle()
    pane.select('q-from-another-project')
    await settle()
    expect(pane.written).toEqual([])
    expect(readScratch).not.toHaveBeenCalled()
    pane.dispose()
  })
})

it.each(['button', 'action'])('%s execute waits for flush and propagates failures without executing stale SQL', async (entry) => {
  const pane = mount()
  try {
    await settle()
    read.mockResolvedValue('SELECT on_screen;')
    let reject!: (cause: Error) => void
    flush.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const execute = () => entry === 'button' ? pane.pressExecute() : pane.execute()
    execute()
    await settle()
    expect(runQuery).not.toHaveBeenCalled()
    reject(new Error('offline'))
    await settle()
    expect(pane.text()).toContain('offline')
    expect(runQuery).not.toHaveBeenCalled()
    runQuery.mockResolvedValue({ columns: [], rows: [], rowCount: 0, command: 'SELECT', ms: 1 })
    execute()
    await settle()
    expect(runQuery).toHaveBeenCalledExactlyOnceWith(taskId, 'SELECT on_screen;')
    read.mockRejectedValueOnce(new Error('retired'))
    execute()
    await settle()
    expect(runQuery).toHaveBeenCalledTimes(1)
    expect(pane.text()).toContain('retired')
  } finally { pane.dispose() }
})

it('ignores held scratch reads after later selection or pane retirement', async () => {
  let complete!: (text: string) => void
  readScratch.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
  const pane = mount()
  await settle()
  pane.select(SCRATCH_SELECT_ID)
  await settle()
  pane.select('q-2')
  await settle()
  complete('SELECT obsolete;')
  await settle()
  expect(pane.written).toEqual(['SELECT 2;'])
  readScratch.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
  pane.select(SCRATCH_SELECT_ID)
  await settle()
  pane.dispose()
  complete('SELECT retired;')
  await settle()
  expect(pane.written).toEqual(['SELECT 2;'])
})

it('restores a filtered table, selected record, and unsaved edits without fetching rows or writing SQL again', async () => {
  let pane = mount()
  await settle()
  const table = pane.nodes().find((node) => node.type === 'Row' && node.props.title === 'public.accounts')!
  ;(table.props.onPress as () => void)()
  await settle()
  ;(pane.nodes().find((node) => node.type === 'Input')!.props.onChange as (value: string) => void)('accounts')
  ;(pane.nodes().find((node) => node.type === 'Grid')!.props.onSelect as (index: number) => void)(0)
  await settle()
  const field = pane.nodes().find((node) => node.type === 'Textarea' && node.props.value === 'Account')!
  ;(field.props.onChange as (value: string) => void)('Unsaved account')
  pane.dispose()

  // Returning uses a new bridge and renders before even the connection check can settle.
  let connected!: () => void
  connectDb.mockImplementationOnce(() => new Promise((resolve) => { connected = () => resolve({ ok: true, database: 'dev' }) }))
  pane = mount()
  expect(pane.nodes().find((node) => node.type === 'Input')?.props.value).toBe('accounts')
  expect(pane.text()).toContain('Row in accounts')
  expect(pane.nodes().find((node) => node.type === 'Textarea' && node.props.value === 'Unsaved account')).toBeDefined()
  expect(pane.written).toEqual([])
  expect(listRows).toHaveBeenCalledTimes(1)
  expect(runQuery).not.toHaveBeenCalled()
  await settle()
  connected()
  await settle()
  listRows.mockResolvedValueOnce({ columns: ['id', 'name'], rows: [['1', 'Unsaved account']], rowCount: 1, command: 'SELECT', total: 1 })
  const save = pane.nodes().find((node) => node.type === 'Button' && node.props.variant === 'solid' && node.children.some((child) => child.props.value === 'Save'))!
  ;(save.props.onPress as () => void)()
  await settle()
  expect(updateCell).toHaveBeenCalledExactlyOnceWith(taskId, 'public', 'accounts', 'name', 'Unsaved account', { id: '1' })
  expect(pane.nodes().find((node) => node.type === 'Grid')?.props.rows).toEqual([['1', 'Unsaved account']])
  pane.dispose()
})

it('keeps query results independent across tasks and Nodes and never replays SQL on return', async () => {
  read.mockResolvedValue('SELECT original;')
  runQuery.mockResolvedValueOnce({ columns: ['value'], rows: [['original result']], rowCount: 1, command: 'SELECT', ms: 7 })
  const original = mount()
  await settle()
  original.execute()
  await settle()
  // A held second result must not replace the cached answer after its pane retires.
  let complete!: (result: unknown) => void
  runQuery.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
  original.execute()
  await settle()
  original.dispose()
  for (const scope of [{ taskId: `${taskId}-other` }, { nodeId: 'node-b' }]) {
    const other = mount(undefined, scope)
    await settle()
    expect(other.nodes().some((node) => node.type === 'Grid')).toBe(false)
    other.dispose()
  }
  const returned = mount()
  expect(returned.nodes().find((node) => node.type === 'Grid')?.props.rows).toEqual([['original result']])
  complete({ columns: ['value'], rows: [['retired result']], rowCount: 1, command: 'SELECT', ms: 9 })
  await settle()
  expect(returned.nodes().find((node) => node.type === 'Grid')?.props.rows).toEqual([['original result']])
  expect(returned.text()).toContain('7ms')
  expect(runQuery).toHaveBeenCalledTimes(2)
  expect(returned.written).toEqual([])
  returned.dispose()
})

it('restores results through host storage after the plugin worker restarts', async () => {
  read.mockResolvedValue('SELECT persisted;')
  runQuery.mockResolvedValueOnce({ columns: ['value'], rows: [['Persisted result']], rowCount: 1, command: 'SELECT', ms: 3 })
  const pane = mount()
  await settle()
  pane.execute()
  await settle()
  pane.dispose()
  // A new module graph has no worker-local workspace cache. The host state still has what was saved.
  vi.resetModules()
  const { DatabasePaneApp: restartedApp } = await import('./app')
  const { solidTree: restartedTree } = await import('@acorn/plugin-api/ui/tree')
  const render = restartedTree(restartedApp)
  // Navigating away before the cold restore finishes must not cache an empty workspace.
  const abandoned = mount(undefined, { render })
  abandoned.dispose()
  const restarted = mount(undefined, { render })
  await settle()
  expect(restarted.nodes().find((node) => node.type === 'Grid')?.props.rows).toEqual([['Persisted result']])
  expect(restarted.written).toEqual([])
  expect(runQuery).toHaveBeenCalledTimes(1)
  restarted.dispose()
})
