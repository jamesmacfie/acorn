import { createSignal } from 'solid-js'
import { panelPlanSchema, type DashboardDraft, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { PlanPartKey } from '@acorn/dashboards-core/outline.ts'
import type { dashboardClient } from '../dashboardClient'
import type { dashboardRecoveryStore } from '../dashboardRecovery'

// The panel studio's state: the plan, the selected part, undo and redo, the Node draft, and autosave
// (docs/dashboards/mapping-and-editor.md § The generated editor). The undo model is the Workflows
// editor's (plugins/workflows/src/client/editor/draftStore.ts), copied rather than imported, because
// client-core can't import a plugin.

const AUTOSAVE_MS = 750
/** How long typing coalesces into one undo step: a word is one undo, a pause makes a boundary. */
const UNDO_COALESCE_MS = 600
const UNDO_DEPTH = 60

export type StudioSaveState = 'Not saved' | 'Saved' | 'Saving…' | 'Saved on this computer' | "Couldn't save"
export type StudioChangeOptions = {
  /** Fold a keystroke into the previous step when it lands within 600 ms of it. */
  coalesce?: boolean
  /** A change the studio derives from another, such as default columns once a picked source is
   *  described. It joins the step that caused it rather than making one of its own, and keeps redo. */
  derived?: boolean
}

export const blankPlan = (): PanelPlan => ({
  version: 2, title: 'New panel', time: { zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', mode: 'fixed', weekStart: 'monday' },
  sources: [], columns: [], stages: [], view: { kind: 'list' },
})

const pushUndo = (stack: readonly PanelPlan[], plan: PanelPlan): PanelPlan[] => [...stack, plan].slice(-UNDO_DEPTH)

export type StudioStore = ReturnType<typeof createStudioStore>

export function createStudioStore(input: {
  nodeId: string
  client: Pick<ReturnType<typeof dashboardClient>, 'create' | 'save'>
  recovery: ReturnType<typeof dashboardRecoveryStore>
  /** The recovery key before the Node has assigned the draft an id. */
  recoveryId: string
}) {
  const { nodeId, client, recovery } = input
  const [plan, setPlan] = createSignal<PanelPlan>(blankPlan())
  const [selected, setSelected] = createSignal<PlanPartKey>()
  const [past, setPast] = createSignal<PanelPlan[]>([])
  const [future, setFuture] = createSignal<PanelPlan[]>([])
  const [draft, setDraft] = createSignal<DashboardDraft>()
  const [saveState, setSaveState] = createSignal<StudioSaveState>('Not saved')
  const [problem, setProblem] = createSignal<string>()
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let lastPush = Number.NEGATIVE_INFINITY
  // Set by the first change, so a draft that loads after someone started typing doesn't replace it.
  let edited = false

  const recoveryCopy = (content: PanelPlan, current = draft()) => ({
    nodeId, entityId: current?.id ?? input.recoveryId, baseRevision: current?.draftRevision ?? 0,
    baseContent: current?.content ?? blankPlan(), content, savedAt: Date.now(),
  })
  /** A device copy on every change, and a Node save once the plan parses and typing pauses. */
  const persist = (next: PanelPlan): void => {
    setSaveState(recovery.save(recoveryCopy(next)) === 'saved-on-device' ? 'Saved on this computer' : 'Not saved')
    if (saveTimer) clearTimeout(saveTimer)
    if (!panelPlanSchema.safeParse(next).success) return
    saveTimer = setTimeout(() => void flush(next).catch(() => {}), AUTOSAVE_MS)
  }
  async function flush(next = plan()): Promise<DashboardDraft> {
    if (saveTimer) clearTimeout(saveTimer)
    setSaveState('Saving…')
    try {
      const current = draft()
      const saved = current ? await client.save(current.id, current.draftRevision, next) : await client.create(next)
      setDraft(saved)
      recovery.acknowledge(recoveryCopy(next, current), saved.content)
      if (!current) recovery.discard(nodeId, input.recoveryId)
      setSaveState('Saved')
      return saved
    } catch {
      setSaveState("Couldn't save")
      setProblem("Couldn't save. Your edits remain on this computer.")
      throw new Error('dashboard-save-failed')
    }
  }
  const show = (next: PanelPlan): void => {
    edited = true
    setPlan(next)
    persist(next)
  }

  /** Change the plan as one undo step, or as part of the last one (`StudioChangeOptions`). */
  const apply = (update: (current: PanelPlan) => PanelPlan, options: StudioChangeOptions = {}): void => {
    const current = plan()
    const next = update(current)
    if (next === current) return
    if (!options.derived) {
      const now = Date.now()
      if (!options.coalesce || now - lastPush > UNDO_COALESCE_MS) {
        setPast(stack => pushUndo(stack, current))
        lastPush = now
      }
      setFuture([])
    }
    show(next)
  }
  const undo = (): void => {
    const stack = past()
    if (!stack.length) return
    setFuture(forward => pushUndo(forward, plan()))
    setPast(stack.slice(0, -1))
    lastPush = Number.NEGATIVE_INFINITY
    show(stack[stack.length - 1]!)
  }
  const redo = (): void => {
    const stack = future()
    if (!stack.length) return
    setPast(back => pushUndo(back, plan()))
    setFuture(stack.slice(0, -1))
    lastPush = Number.NEGATIVE_INFINITY
    show(stack[stack.length - 1]!)
  }

  /** Opens a Node draft, preferring this computer's unsaved copy of it. Not an undo step. */
  const open = (loaded: DashboardDraft): void => {
    setDraft(loaded)
    const restored = recovery.read(nodeId, loaded.id)?.content
    setPlan(restored && 'version' in restored ? restored : loaded.content)
    setPast([])
    setFuture([])
    setSaveState(restored ? 'Saved on this computer' : 'Saved')
  }
  /** Reopens a new panel's copy on this computer, unless editing has already begun. */
  const restoreLocal = (): void => {
    const local = recovery.read(nodeId, input.recoveryId)?.content
    if (edited || !local || !('version' in local)) return
    setPlan(local)
    setSaveState('Saved on this computer')
  }

  return {
    plan, apply, undo, redo,
    canUndo: () => past().length > 0,
    canRedo: () => future().length > 0,
    selected,
    /** Selection moves no data, so it is not an undo step. */
    select: (key: PlanPartKey | undefined) => setSelected(() => key),
    draft, saveState, problem, setProblem, flush, open, restoreLocal,
    edited: () => edited,
    dispose: () => { if (saveTimer) clearTimeout(saveTimer) },
  }
}
