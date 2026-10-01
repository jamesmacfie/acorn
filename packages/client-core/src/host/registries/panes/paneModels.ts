// One pane's shared state, built once per task and handed to every region of its layout.
//
// A layout's regions are separate components the host mounts side by side, so anything two of them
// share has to outlive both of them: collapsing a library unmounts the list, and the note being
// edited must not go with it. Four compiled panes each grew the same module-level `createRoot` map to
// solve that — notes, changes, agents and context — which is the admission rule's own test for a
// seam ("two or more plugins need it"). This is that map, once.
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

type Held = { taskId: string; scope: PaneModelScope; model: unknown; dispose: () => void }
// One current task per pane, shared by its independently mounted regions.
const held = new Map<string, Held>()

function releaseModel(paneId: string, entry: Held): void {
  if (held.get(paneId) === entry) held.delete(paneId)
  entry.dispose()
}

/** Build in a detached root that inherits provider context and retires with its captured shell. */
export function paneModel<M>(paneId: string, taskId: string, build: () => M, owner = 'core', scope = paneModelScope()): M {
  const entry = held.get(paneId)
  if (entry && entry.taskId === taskId && entry.scope === scope && !scope.retired) return entry.model as M
  if (entry) releaseModel(paneId, entry)
  if (scope.retired) throw new Error('Cannot build a pane model in a retired Node shell.')
  const span = startSpan(owner, { name: 'pane.model', attrs: { seam: 'pane.model', 'pane.id': paneId, 'task.id': taskId } })
  let disposeRoot: (() => void) | undefined
  try {
    const next = createRoot((dispose) => {
      disposeRoot = dispose
      return { taskId, scope, model: build(), dispose }
    })
    if (scope.retired) throw new Error('The Node shell retired while building its pane model.')
    held.set(paneId, next)
    span.end()
    return next.model as M
  } catch (error) {
    disposeRoot?.()
    span.end('error')
    throw error
  }
}

const [drawn, setDrawn] = createSignal<ReadonlyMap<string, number>>(new Map())
const drawnKey = (scope: PaneModelScope, paneId: string, taskId: string): string => `${scope.id}\u0000${paneId}\u0000${taskId}`

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
  for (const [paneId, entry] of held) if (entry.scope === scope) releaseModel(paneId, entry)
  setDrawn((current) => new Map([...current].filter(([key]) => !key.startsWith(`${scope.id}\u0000`))))
}

onScopeEvicted((event) => {
  if (event.scope === 'node-switched') {
    for (const scope of [...scopes.values()]) {
      if (event.from === undefined ? scope.nodeId !== activeNodeId() : scope.nodeId === event.from) retireScope(scope)
    }
  }
  if (event.scope === 'task') {
    for (const [paneId, entry] of held) {
      if (entry.taskId === event.taskId && entry.scope.nodeId === activeNodeId()) releaseModel(paneId, entry)
    }
  }
})

/** Test seam; production shells release their own lease. */
export const _resetPaneModels = (): void => {
  for (const scope of [...scopes.values()]) retireScope(scope)
  for (const [paneId, entry] of held) releaseModel(paneId, entry)
  setDrawn(new Map())
}
