import type { WorkflowDef } from '../../shared/workflowContracts'
import { mergeWorkflow, type WorkflowMergeConflict } from '../../shared/workflowMerge'
import { workflowRecoveryStore, type WorkflowRecovery } from './recoveryStore'

type SavedDraft = { revision: number; def: WorkflowDef }
type Request = { def: WorkflowDef; settle: ((saved: boolean) => void)[] }
const deliveries = new Map<string, Promise<void>>()

/** The submitted base and recovery copy belong to this entity, including after navigation. */
export function workflowDraftCustody(input: {
  nodeId: string
  entityId: string
  initial: SavedDraft
  recovery: ReturnType<typeof workflowRecoveryStore>
  write: (def: WorkflowDef, revision: number) => Promise<SavedDraft>
  read: () => Promise<SavedDraft>
  changed: () => void
}) {
  let running: Request | undefined
  let pending: Request | undefined
  const state = {
    base: input.initial.def,
    revision: input.initial.revision,
    local: input.initial.def,
    status: 'saved' as 'saved' | 'saving' | 'unsaved' | 'conflict',
    message: undefined as string | undefined,
    conflicts: [] as WorkflowMergeConflict[],
    merge: undefined as { base: WorkflowDef; local: WorkflowDef; external: WorkflowDef; choices: Record<string, 'local' | 'external'> } | undefined,
  }
  const dirty = () => JSON.stringify(state.local) !== JSON.stringify(state.base)
  const copy = (local: WorkflowDef): WorkflowRecovery => ({
    nodeId: input.nodeId, entityId: input.entityId, baseRevision: state.revision,
    base: state.base, local, savedAt: Date.now(),
  })
  const retain = () => { if (dirty()) input.recovery.save(copy(state.local)) }
  const deliver = async (request: Request): Promise<void> => {
    running = request
    state.status = 'saving'
    input.changed()
    const key = JSON.stringify([input.nodeId, input.entityId])
    const previous = deliveries.get(key)
    let release!: () => void
    const delivery = new Promise<void>(resolve => { release = resolve })
    deliveries.set(key, delivery)
    if (previous) await previous
    const submitted = copy(request.def)
    input.recovery.save(submitted)
    // Preserve an edit made after this queued request was captured.
    if (state.local !== request.def) retain()
    state.status = 'saving'
    state.message = undefined
    input.changed()
    let saved = false
    try {
      const answer = await input.write(submitted.local, submitted.baseRevision)
      input.recovery.acknowledge(submitted, answer.revision, answer.def)
      state.revision = answer.revision
      state.base = answer.def
      state.status = dirty() ? 'saving' : 'saved'
      retain()
      saved = true
    } catch (error) {
      state.status = 'unsaved'
      state.message = error instanceof Error ? error.message : 'That save did not land.'
      const remote = await input.read().catch(() => undefined)
      if (remote && remote.revision !== submitted.baseRevision) {
        state.merge = { base: submitted.base, local: state.local, external: remote.def, choices: {} }
        const merged = mergeWorkflow(state.merge.base, state.merge.local, state.merge.external)
        state.local = merged.value
        state.conflicts = merged.conflicts
        state.revision = remote.revision
        state.base = remote.def
        state.status = merged.conflicts.length ? 'conflict' : 'unsaved'
      }
      retain()
    }
    running = undefined
    release()
    if (deliveries.get(key) === delivery) deliveries.delete(key)
    input.changed()
    request.settle.forEach(resolve => resolve(saved))
    const next = pending
    pending = undefined
    if (next) {
      if (!saved || state.conflicts.length) next.settle.forEach(resolve => resolve(false))
      else void deliver(next)
    }
  }
  return {
    state, dirty,
    edit(def: WorkflowDef): void {
      state.local = def
      retain()
      if (dirty() && !state.conflicts.length) state.status = 'saving'
    },
    save(def = state.local): Promise<boolean> {
      if (state.conflicts.length) return Promise.resolve(false)
      if (!running && JSON.stringify(def) === JSON.stringify(state.base)) return Promise.resolve(true)
      return new Promise(resolve => {
        if (running) {
          if (!pending && JSON.stringify(running.def) === JSON.stringify(def)) running.settle.push(resolve)
          else if (pending) { pending.def = def; pending.settle.push(resolve) }
          else pending = { def, settle: [resolve] }
        } else void deliver({ def, settle: [resolve] })
      })
    },
    get busy(): boolean { return !!running },
  }
}
