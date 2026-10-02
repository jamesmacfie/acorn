import pg from 'pg'
import type { DataTable } from './data'

export type DataPoolEntry = {
  pool: InstanceType<typeof pg.Pool>
  database: string
  retired: boolean
  readers: number
  closing?: Promise<void>
  schemaVersion: number
  catalog?: DataTable[]
  catalogWave?: Promise<DataTable[]>
}

type TaskPools = {
  retired: boolean
  claims: Map<object, object>
  candidates: Set<DataPoolEntry>
  entry?: DataPoolEntry
  pending?: Promise<DataPoolEntry>
}

const retired = () => new Error('Database connection retired. Connect again.')

/** Task pools are shared; each capability projection holds its own revocable task claim. */
export function taskDataPools(resolveUrl: (taskId: string) => Promise<string | null>) {
  const tasks = new Map<string, TaskPools>()
  const close = (entry: DataPoolEntry): Promise<void> => {
    if (entry.readers) return Promise.resolve()
    return entry.closing ??= entry.pool.end().catch(() => {})
  }
  const retire = (entry: DataPoolEntry) => {
    entry.retired = true
    entry.schemaVersion++
    entry.catalog = undefined
    entry.catalogWave = undefined
    return close(entry)
  }

  const admission = (taskId: string, owner: object, refresh: boolean) => {
    let state = tasks.get(taskId)
    if (!state) {
      state = { retired: false, claims: new Map(), candidates: new Set() }
      tasks.set(taskId, state)
    }
    const task = state
    const claim = task.claims.get(owner) ?? {}
    task.claims.set(owner, claim)
    const valid = () => !task.retired && task.claims.get(owner) === claim
    if (!refresh && !task.pending && task.entry) {
      return { result: Promise.resolve(task.entry), valid }
    }
    if (!refresh && task.pending) return { result: task.pending, valid }

    const openingValid = () => !task.retired && task.claims.size > 0
    const preceding = task.pending
    const result = Promise.resolve().then(async () => {
      // Explicit refreshes each resolve their source after the preceding refresh settles.
      await preceding?.catch(() => {})
      if (!openingValid()) throw retired()
      const url = await resolveUrl(taskId)
      if (!openingValid()) throw retired()
      if (!url) throw new Error('No database found. Set a connection script in Workspace Settings, or add DATABASE_URL to the worktree .env.')
      const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 8_000 })
      pool.on('error', () => {})
      const entry: DataPoolEntry = { pool, database: '', retired: false, readers: 0, schemaVersion: 0 }
      task.candidates.add(entry)
      try {
        const response = await pool.query<{ database: string }>('SELECT current_database() AS database')
        // Other claims can keep an implicit opening alive when its first reader departs.
        if (!openingValid() || entry.retired) throw retired()
        entry.database = response.rows[0]?.database ?? ''
        const previous = task.entry
        task.entry = entry
        if (previous) void retire(previous)
        return entry
      } catch (error) {
        await retire(entry)
        throw error
      } finally {
        task.candidates.delete(entry)
      }
    })
    task.pending = result
    void result.finally(() => {
      if (task.pending === result) task.pending = undefined
      if (!task.entry && !task.pending && tasks.get(taskId) === task) tasks.delete(taskId)
    }).catch(() => {})
    return { result, valid }
  }

  return {
    claim: (taskId: string, owner: object) => {
      let task = tasks.get(taskId)
      if (!task) {
        task = { retired: false, claims: new Map(), candidates: new Set() }
        tasks.set(taskId, task)
      }
      const state = task
      const claim = state.claims.get(owner) ?? {}
      state.claims.set(owner, claim)
      return () => !state.retired && state.claims.get(owner) === claim
    },
    connect: async (taskId: string, owner: object, refresh: boolean) => {
      const { result, valid } = admission(taskId, owner, refresh)
      const entry = await result
      if (!valid()) throw retired()
      return entry
    },
    use: async <T>(taskId: string, owner: object, operation: (entry: DataPoolEntry) => Promise<T>): Promise<T> => {
      const { result, valid } = admission(taskId, owner, false)
      const entry = await result
      if (!valid() || entry.retired) throw retired()
      // Reserve before another await; retirement drains admitted operations before ending the pool.
      entry.readers++
      try { return await operation(entry) }
      finally {
        entry.readers--
        if (entry.retired) await close(entry)
      }
    },
    disconnect: async (taskId: string, owner: object, all = false) => {
      const task = tasks.get(taskId)
      if (!task) return
      task.claims.delete(owner)
      if (!all && task.claims.size) return
      tasks.delete(taskId)
      task.retired = true
      task.claims.clear()
      await Promise.all([...task.candidates, ...(task.entry ? [task.entry] : [])].map(retire))
    },
  }
}
