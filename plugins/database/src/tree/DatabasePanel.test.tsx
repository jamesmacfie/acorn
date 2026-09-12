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
// never runs it (docs/database.md § From the command palette). Running is
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
const readScratch = vi.fn(async () => 'SELECT generated;')
let saved: () => Promise<DbSavedQuery[]> = async () => queries

vi.mock('./databaseClient', () => ({
  connectDb: async () => ({ ok: true, database: 'dev' }),
  disconnectDb: async () => ({ ok: true }),
  listTables: async () => ({ tables: [] }),
  listColumns: async () => ({ columns: [] }),
  listRows: async () => ({ columns: [], rows: [], rowCount: 0, command: 'SELECT', total: 0 }),
  listSavedQueries: () => saved(),
  listModelBackends: async () => [],
  deleteSavedQuery: async () => {},
  updateCell: async () => ({ ok: true, rowCount: 1 }),
  insertRow: async () => ({ ok: true, rowCount: 1 }),
  deleteRow: async () => ({ ok: true, rowCount: 1 }),
  readScratch: () => readScratch(),
  runQuery: (...args: unknown[]) => runQuery(...args),
}))

const settle = async () => {
  for (let at = 0; at < 4; at++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

type Harness = { written: string[]; select: (item: string) => void; dispose: () => void }

const mount = (item?: string): Harness => {
  const ops: TreeMutation[] = []
  const root = createRemoteRoot((batch) => ops.push(...batch))
  const written: string[] = []
  let onSelect: (item: string) => void = () => {}
  const bridge = {
    context: { surface: 'database', target: 'remote', nodeId: 'node-a', ...(item ? { item } : {}) },
    document: {
      read: async () => '',
      write: async (text: string) => void written.push(text),
      flush: async () => {},
    },
    onSelect: (handler: (item: string) => void) => {
      onSelect = handler
      return () => {}
    },
    onSurfaceAction: () => () => {},
  } as unknown as AcornBridge
  solidTree(DatabasePaneApp)(bridge, {
    entry: 'panel',
    root,
    props: () => ({ taskId: 'task-1' }),
    onProps: () => {},
    onUnmount: () => {},
    // This tree asks its host for nothing, so both throw: a fixture that silently answered
    // would hide a component that started asking.
    host: {
      invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
      openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
    },
  })
  return { written, select: (next) => onSelect(next), dispose: () => root.dispose() }
}

describe('what the palette hands the Database pane', () => {
  beforeEach(() => {
    runQuery.mockClear()
    readScratch.mockClear()
    saved = async () => queries
  })

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
