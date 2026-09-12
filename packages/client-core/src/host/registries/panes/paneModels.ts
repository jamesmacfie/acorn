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
import { createRoot } from 'solid-js'
import { startSpan } from '../../../infra/telemetry/emitter'
import { onScopeEvicted } from '../shell/scopeEviction'

type Held = { taskId: string; model: unknown; dispose: () => void }

// Keyed by pane id, holding one task at a time. One task is on screen at a time, so anything else is
// a task somebody navigated away from, and disposing it eagerly is what flushes a pending save —
// which is the behaviour every one of the four hand-rolled maps had, and the reason this is not a
// two-level map.
const held = new Map<string, Held>()

/**
 * The model for this pane and this task, built on first ask.
 *
 * `build` runs inside the new root, so everything it creates is disposed together. It is called at
 * most once per (pane, task); a later call with the same task returns what it returned.
 *
 * The `pane.model` span covers the build and nothing else. A cache hit is not timed, because a pane
 * whose model is already there did no work, and averaging the hits in would hide the build that
 * takes a second (docs/telemetry.md § The admission rule for a span).
 */
export function paneModel<M>(paneId: string, taskId: string, build: () => M, owner = 'core'): M {
  const entry = held.get(paneId)
  if (entry && entry.taskId === taskId) return entry.model as M
  entry?.dispose()
  const span = startSpan(owner, { name: 'pane.model', attrs: { seam: 'pane.model', 'pane.id': paneId, 'task.id': taskId } })
  try {
    const next = createRoot((dispose) => ({ taskId, model: build(), dispose }))
    held.set(paneId, next)
    span.end()
    return next.model as M
  } catch (error) {
    span.end('error')
    throw error
  }
}

onScopeEvicted((event) => {
  if (event.scope !== 'task') return
  for (const [paneId, entry] of held) {
    if (entry.taskId !== event.taskId) continue
    entry.dispose()
    held.delete(paneId)
  }
})

/** Test seam. Disposes everything held, so one suite's models do not reach the next. */
export const _resetPaneModels = (): void => {
  for (const entry of held.values()) entry.dispose()
  held.clear()
}
