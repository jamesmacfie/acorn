// One pane's shared state, built once per task and handed to every region of its layout.
//
// Each pane keeps the models of the last few tasks it drew, so leaving a task and coming back finds
// the note, the undo history and the filter as they were. How many is the reader's choice
// (`keptTasks`). A model kept for a task that's out of view must stay quiet, which is what `shown`
// on `PaneModelContext` is for (./panes.ts).
//
// A layout's regions are separate components the host mounts side by side, so anything two of them
// share has to outlive both of them: collapsing a library unmounts the list, and the note being
// edited must not go with it. Several panes need that (notes, changes, agents and context), so the
// module-level `createRoot` map lives here once rather than in each of them.
//
// `createRoot` rather than a plain object because a model owns resources and effects, and their owner
// has to be one the host's mounting and unmounting cannot take away. No detached owner is passed, and
// that is deliberate: Solid's `createRoot` with no second argument still copies the *context* off
// whichever owner is current while never adding the new root to that owner's `owned` list, so the
// query client stays in scope and disposal stays this module's to call. An explicit `null` owner
// would lose the query client instead.
//
// A loaded plugin needs nothing here. Its regions are entries in one worker bundle, so module scope
// inside that bundle already is the shared thing (`mountTree({ list, detail })`); this seam exists
// because a compiled plugin's regions are components in the shell's realm with no module of their
// own to share.
import { createContext, createRoot, createSignal, useContext } from 'solid-js'
import { activeNodeId } from '../../../infra/node/activeNode'
import { readDevicePrefs } from '../../../infra/persistence/devicePrefs'
import { PrefKeys } from '../../../infra/persistence/prefKeys'
import { startSpan } from '../../../infra/telemetry/emitter'
import { onScopeEvicted } from '../shell/scopeEviction'

export type PaneModelScope = { readonly id: number; readonly nodeId: string | null; retired: boolean; leases: number }
export const PaneModelScopeContext = createContext<PaneModelScope>()
const scopes = new Map<string | null, PaneModelScope>()
let nextScope = 0

function scopeFor(nodeId: string | null): PaneModelScope {
  let scope = scopes.get(nodeId)
  if (!scope || scope.retired) {
    scope = { id: ++nextScope, nodeId, retired: false, leases: 0 }
    scopes.set(nodeId, scope)
  }
  return scope
}

/** Capture before creating lazy regions or deferred model callbacks. */
export const paneModelScope = (): PaneModelScope => useContext(PaneModelScopeContext) ?? scopeFor(activeNodeId())

/** A shell owns a lease; closing a pane or region does not release it. */
export function acquirePaneModelHost(nodeId: string | null): { scope: PaneModelScope; release(): void } {
  const scope = scopeFor(nodeId)
  scope.leases++
  let released = false
  return {
    scope,
    release() {
      if (released) return
      released = true
      scope.leases--
      if (!scope.leases) retireScope(scope)
    },
  }
}

/** How many tasks each pane keeps a model for: Settings > General > Performance. */
export const KEPT_TASK_CHOICES: readonly number[] = [1, 3, 5, 10]
export const DEFAULT_KEPT_TASKS = 5
// Straight from the device store, because this isn't a component and has no query client to hand.
// The key never reaches a Node, so `localStorage` is the whole truth.
export function keptTasks(prefs: Readonly<Record<string, string>> | undefined = readDevicePrefs()): number {
  const value = Number(prefs?.[PrefKeys.keptTasks])
  return KEPT_TASK_CHOICES.includes(value) ? value : DEFAULT_KEPT_TASKS
}

type Held = { scope: PaneModelScope; model: unknown; dispose: () => void }
// Per pane, the kept models by task, least recently used first. A use moves its task to the end.
const held = new Map<string, Map<string, Held>>()

function releaseModel(paneId: string, taskId: string, entry: Held): void {
  const tasks = held.get(paneId)
  if (tasks?.get(taskId) === entry) {
    tasks.delete(taskId)
    if (!tasks.size) held.delete(paneId)
  }
  entry.dispose()
}

function* heldEntries(): Generator<[paneId: string, taskId: string, entry: Held]> {
  for (const [paneId, tasks] of [...held]) for (const [taskId, entry] of [...tasks]) yield [paneId, taskId, entry]
}

/** Build in a detached root that inherits provider context and retires with its captured shell. */
export function paneModel<M>(
  paneId: string,
  taskId: string,
  build: () => M,
  owner = 'core',
  scope = paneModelScope(),
): M {
  const kept = held.get(paneId)
  const entry = kept?.get(taskId)
  if (kept && entry && entry.scope === scope && !scope.retired) {
    kept.delete(taskId)
    kept.set(taskId, entry)
    return entry.model as M
  }
  if (entry) releaseModel(paneId, taskId, entry)
  if (scope.retired) throw new Error('Cannot build a pane model in a retired Node shell.')
  const span = startSpan(owner, {
    name: 'pane.model',
    attrs: { seam: 'pane.model', 'pane.id': paneId, 'task.id': taskId },
  })
  let disposeRoot: (() => void) | undefined
  try {
    const next = createRoot((dispose) => {
      disposeRoot = dispose
      return { scope, model: build(), dispose }
    })
    if (scope.retired) throw new Error('The Node shell retired while building its pane model.')
    const tasks = held.get(paneId) ?? new Map<string, Held>()
    held.set(paneId, tasks)
    tasks.set(taskId, next)
    // Disposing the oldest is what flushes its pending saves (the editor's document pool, notes' autosave).
    const limit = keptTasks()
    for (const [oldest, dropped] of tasks) {
      if (tasks.size <= limit) break
      releaseModel(paneId, oldest, dropped)
    }
    span.end()
    return next.model as M
  } catch (error) {
    disposeRoot?.()
    span.end('error')
    throw error
  }
}

const [drawn, setDrawn] = createSignal<ReadonlyMap<string, number>>(new Map())
const drawnKey = (scope: PaneModelScope, paneId: string, taskId: string): string =>
  `${scope.id}\u0000${paneId}\u0000${taskId}`

function countDrawn(key: string, by: number): void {
  setDrawn((current) => {
    const next = new Map(current)
    const count = (next.get(key) ?? 0) + by
    if (count > 0) next.set(key, count)
    else next.delete(key)
    return next
  })
}

/** Count only this captured shell generation until its surface releases the mark. */
export function markPaneDrawn(paneId: string, taskId: string, scope = paneModelScope()): () => void {
  if (scope.retired) return () => {}
  const key = drawnKey(scope, paneId, taskId)
  countDrawn(key, 1)
  let released = false
  return () => {
    if (released) return
    released = true
    countDrawn(key, -1)
  }
}

export const paneDrawn = (paneId: string, taskId: string, scope = paneModelScope()): boolean =>
  !scope.retired && (drawn().get(drawnKey(scope, paneId, taskId)) ?? 0) > 0

function retireScope(scope: PaneModelScope): void {
  if (scope.retired) return
  scope.retired = true
  if (scopes.get(scope.nodeId) === scope) scopes.delete(scope.nodeId)
  for (const [paneId, taskId, entry] of heldEntries()) if (entry.scope === scope) releaseModel(paneId, taskId, entry)
  setDrawn((current) => new Map([...current].filter(([key]) => !key.startsWith(`${scope.id}\u0000`))))
}

onScopeEvicted((event) => {
  if (event.scope === 'node-switched') {
    for (const scope of [...scopes.values()]) {
      if (event.from === undefined ? scope.nodeId !== activeNodeId() : scope.nodeId === event.from) retireScope(scope)
    }
  }
  if (event.scope === 'task') {
    for (const [paneId, taskId, entry] of heldEntries()) {
      if (taskId === event.taskId && entry.scope.nodeId === activeNodeId()) releaseModel(paneId, taskId, entry)
    }
  }
})

/** Test seam; production shells release their own lease. */
export const _resetPaneModels = (): void => {
  for (const scope of [...scopes.values()]) retireScope(scope)
  for (const [paneId, taskId, entry] of heldEntries()) releaseModel(paneId, taskId, entry)
  setDrawn(new Map())
}
