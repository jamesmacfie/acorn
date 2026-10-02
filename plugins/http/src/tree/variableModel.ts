import { createEffect, createSignal, onCleanup } from 'solid-js'
import type { HttpVariable, VariableKind } from '../shared/model'
import type { HttpClient } from './httpClient'
import { withAbort } from './requestOperation'
import { serializeHttpWrite } from './httpWrites'

export type VariableRow = { key: string; id: string | null; name: string; kind: VariableKind; value: string; enabled: boolean; hasStoredSecret: boolean }
type Entry = { row: VariableRow; revision: number; dirty: boolean; write?: Promise<void> }
const subjects = new Map<string, Entry[]>()
const legacy = new WeakMap<HttpClient, number>()
let sequence = 0
export function variableScope(client: HttpClient, projectId: string): string {
  let id = legacy.get(client)
  if (!id) { id = ++sequence; legacy.set(client, id) }
  return JSON.stringify([client.scope ?? `legacy-client:${id}`, projectId])
}
const toRow = (row: HttpVariable, key = row.id): VariableRow => ({ ...row, key, hasStoredSecret: row.kind === 'secret' })

// Draft custody survives a component root, without keeping its client or retired bridge.
export function createVariableModel(client: () => HttpClient, projectId: () => string) {
  const [rows, setRows] = createSignal<VariableRow[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal<string[]>([])
  let entries: Entry[] = [], generation = 0, disposed = false
  const operations = new Set<AbortController>()
  const publish = () => setRows(entries.map((entry) => entry.row))
  const retire = () => { for (const controller of operations) controller.abort(); operations.clear(); setBusy([]) }
  onCleanup(() => { disposed = true; generation++; retire() })
  createEffect(() => {
    const origin = client(), project = projectId(), scope = variableScope(origin, project)
    retire()
    const selectedGeneration = ++generation
    entries = subjects.get(scope) ?? []
    subjects.set(scope, entries)
    setError(null)
    publish()
    const controller = new AbortController()
    operations.add(controller)
    void withAbort(controller.signal, () => origin.listVariables(project, controller.signal)).then((saved) => {
      if (disposed || generation !== selectedGeneration) return
      // Reconcile by identity. A held load cannot erase edits made before it returned.
      const dirty = entries.filter((entry) => entry.dirty || entry.write)
      const dirtyIds = new Set(dirty.map((entry) => entry.row.id))
      entries.splice(0, entries.length, ...saved.filter((row) => !dirtyIds.has(row.id)).map((row) => ({ row: toRow(row), revision: 0, dirty: false })), ...dirty)
      subjects.set(scope, entries)
      publish()
    }).catch((err) => {
      if (!disposed && generation === selectedGeneration && !controller.signal.aborted)
        setError(err instanceof Error ? err.message : 'Could not refresh variables')
    }).finally(() => operations.delete(controller))
  })
  const editRow = (index: number, patch: Partial<VariableRow>) => {
    const entry = entries[index]
    if (disposed || !entry) return
    entry.row = { ...entry.row, ...patch }
    entry.revision++
    entry.dirty = true
    publish()
  }
  const add = () => {
    if (disposed) return
    entries.push({ row: { key: `new:${++sequence}`, id: null, name: '', kind: 'value', value: '', enabled: true, hasStoredSecret: false }, revision: 0, dirty: true })
    publish()
  }
  async function mutate(index: number, remove: boolean) {
    const entry = entries[index]
    if (disposed || !entry) return
    const origin = client(), project = projectId(), ownerEntries = entries
    const selectedGeneration = generation, revision = entry.revision, submitted = { ...entry.row }
    if (!remove && !submitted.name.trim()) return setError('A variable needs a name.')
    const controller = new AbortController(), previous = entry.write
    operations.add(controller)
    setBusy((keys) => [...keys, submitted.key])
    setError(null)
    const current = () => !disposed && generation === selectedGeneration
    const operation = (async () => {
      try {
        if (previous) await withAbort(controller.signal, () => previous)
        controller.signal.throwIfAborted()
        const identity = JSON.stringify([origin.nodeId ?? origin.scope ?? variableScope(origin, project), project, 'variable', entry.row.id ?? entry.row.key])
        await serializeHttpWrite(identity, controller.signal, async () => {
          if (remove) {
            if (entry.row.id) await withAbort(controller.signal, () => origin.deleteVariable(project, entry.row.id!, controller.signal))
            if (entry.revision === revision) ownerEntries.splice(ownerEntries.indexOf(entry), 1)
            else { entry.row = { ...entry.row, id: null, hasStoredSecret: false }; entry.dirty = true }
          } else {
            const body = { name: submitted.name.trim(), kind: submitted.kind, value: submitted.value, enabled: submitted.enabled }
            const next = await withAbort(controller.signal, () => entry.row.id
              ? origin.updateVariable(project, entry.row.id, body, controller.signal)
              : origin.createVariable(project, body, controller.signal))
            if (entry.revision === revision) { entry.row = toRow(next, submitted.key); entry.dirty = false }
            else entry.row = { ...entry.row, id: next.id, hasStoredSecret: next.kind === 'secret' }
          }
        })
      } catch (err) {
        entry.dirty = true
        if (current() && !controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not save the variable')
      } finally {
        operations.delete(controller)
        if (current()) { setBusy((keys) => { const next = [...keys]; next.splice(next.indexOf(submitted.key), 1); return next }); publish() }
      }
    })()
    entry.write = operation
    await operation
    if (entry.write === operation) entry.write = undefined
  }
  return { rows, error, busy, editRow, add, save: (index: number) => mutate(index, false), remove: (index: number) => mutate(index, true) }
}
