// What every region of the run pane shares: the task's runs, the selected run's nodes, the live
// tail of each node, and the four things a person can do to a run
// (docs/workflows.md § Routes and UI).
//
// Built once per task in the host's own root (client-core registries/panes/paneModels.ts), so the
// three socket subscriptions below are opened once for the pane and not once per region.
import { createEffect, createMemo, createResource, createSignal, onCleanup } from 'solid-js'
import {
  clientEvents, consumePaneIntent, onPluginFrame, type PaneIntent, type Task,
  wsOnReconnect, wsOnWorkflowStepChanged, wsOnWorkflowStepEvent,
} from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { WorkflowRunRow } from '@acorn/protocol/workflow.ts'
import type { WorkflowChildRunSummary, WorkflowRunProjection, WorkflowStepProjection } from '../../shared/api'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { isWorkflowStepEvent } from '../../shared/stepEvents'
import { graphOrder } from '../editor/draft'
import { workflowApi } from '../workflowsClient'

export const WORKFLOWS_PANE_ID = 'workflows'

/** The last 200 events per step and the last 4,000 characters of its output. A command that prints a
 *  megabyte is still a step whose tail you want to read; the whole stream is on the row. */
const EVENT_CAP = 200
const TAIL_CHARS = 4000

/** One row of the node list: the graph position the editor draws, plus the row that ran it. */
export type RunNode = {
  name: string
  depth: number
  parents: readonly string[]
  step: WorkflowStepProjection | undefined
}

export type RunPaneModel = ReturnType<typeof createRunPaneModel>

const parseDef = (raw: string | undefined): WorkflowDef | null => {
  if (!raw) return null
  try {
    return JSON.parse(raw) as WorkflowDef
  } catch {
    return null
  }
}

const LIVE_RUN = new Set(['running', 'gated', 'cancelling'])
export const isLiveRun = (run: WorkflowRunRow | undefined): boolean => !!run && LIVE_RUN.has(run.status)

export function createRunPaneModel(task: Task) {
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [selectedRunId, setSelectedRunId] = createSignal<string>()
  const [selectedStepId, setSelectedStepId] = createSignal<string>()
  // Keyed by step, because the pane keeps what a node said while you look at its sibling.
  const [events, setEvents] = createSignal<Record<string, unknown[]>>({})
  const [tails, setTails] = createSignal<Record<string, string>>({})
  const [now, setNow] = createSignal(Date.now())

  const [runs, { refetch: refetchRuns }] = createResource<WorkflowRunProjection[]>(() => workflowApi.runs(task.id), { initialValue: [] })
  const [steps, { refetch: refetchSteps, mutate: mutateSteps }] = createResource(
    () => selectedRunId(),
    (runId) => workflowApi.steps(runId),
    { initialValue: [] },
  )

  const selectedRun = createMemo(() => runs().find((run) => run.id === selectedRunId()))
  const selectedStep = createMemo(() => steps().find((step) => step.id === selectedStepId()))

  // The newest run, until somebody says otherwise. Also the recovery when the selected run is gone.
  createEffect(() => {
    if (runs().some((run) => run.id === selectedRunId())) return
    const newest = runs()[0]
    if (newest) setSelectedRunId(newest.id)
  })

  // What is worth looking at first: whatever is blocked, then whatever is running, then whatever
  // broke, then the top of the list. Skipped when an intent already named a node of this run.
  createEffect(() => {
    const rows = steps()
    if (!rows.length || rows.some((step) => step.id === selectedStepId())) return
    const focus = rows.find((step) => step.status === 'waiting-gate')
      ?? rows.find((step) => step.status === 'running')
      ?? rows.find((step) => step.status === 'failed' || step.status === 'safety-rail')
      ?? rows[0]
    setSelectedStepId(focus.id)
  })

  // The elapsed column, and only while something is running. A finished step's elapsed is two stored
  // timestamps and needs no clock at all.
  createEffect(() => {
    if (!steps().some((step) => step.status === 'running')) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  // The run's frozen definition is what says which step waits on which, so the pane's indentation is
  // the editor's: one `graphOrder`, two lists (../editor/draft.ts). A fan-out child is a row under
  // the step that spawned it, which the definition cannot know.
  const nodes = createMemo<RunNode[]>(() => {
    const rows = steps()
    const def = parseDef(selectedRun()?.defJson)
    const top = rows.filter((step) => !step.parentStepId)
    const byName = new Map(top.map((step) => [step.name, step]))
    const order = def
      ? graphOrder(def)
      : top.map((step) => ({ name: step.name, depth: 0, parents: [] as string[] }))
    const out: RunNode[] = []
    for (const row of order) {
      const step = byName.get(row.name)
      out.push({ ...row, step })
      if (!step) continue
      for (const child of rows.filter((candidate) => candidate.parentStepId === step.id)) {
        out.push({ name: child.name, depth: row.depth + 1, parents: [row.name], step: child })
      }
    }
    return out
  })

  const selectRun = (runId: string): void => {
    if (runId === selectedRunId()) return
    setSelectedRunId(runId)
    setSelectedStepId(undefined)
    setError('')
  }

  // ── Live state ────────────────────────────────────────────────────────────────────────────────
  //
  // A status edge moves one glyph and reads nothing (`workflow:step-changed`). A run beginning or
  // ending re-reads, because it changes rows this client never saw.
  onCleanup(wsOnWorkflowStepChanged(({ runId, stepId, status }) => {
    if (runId !== selectedRunId()) return
    mutateSteps((current) => current.map((step) =>
      step.id === stepId ? { ...step, status: status as WorkflowStepProjection['status'], updatedAt: Date.now() } : step))
  }))

  onCleanup(wsOnWorkflowStepEvent(({ runId, stepId, event }) => {
    if (runId !== selectedRunId()) return
    setEvents((current) => ({ ...current, [stepId]: [...(current[stepId] ?? []), event].slice(-EVENT_CAP) }))
    if (!isWorkflowStepEvent(event) || (event.type !== 'stdout' && event.type !== 'stderr')) return
    const text = event.text
    setTails((current) => {
      const next = (current[stepId] ?? '') + text
      return { ...current, [stepId]: next.length > TAIL_CHARS ? next.slice(-TAIL_CHARS) : next }
    })
  }))

  const refresh = (): void => {
    void refetchRuns()
    void refetchSteps()
  }

  onCleanup(onPluginFrame('workflows', pluginChannel('workflows', 'run-changed'), (payload) => {
    const changed = payload as Partial<{ taskId: string; runId: string }>
    if (changed.taskId !== task.id && changed.runId !== selectedRunId()) return
    refresh()
  }))
  onCleanup(onPluginFrame('workflows', pluginChannel('workflows', 'child-changed'), (payload) => {
    const changed = payload as Partial<WorkflowChildRunSummary & { ownerTaskId: string }>
    if (changed.ownerTaskId !== task.id && changed.ownerTaskId !== selectedRun()?.parentTaskId) return
    refresh()
  }))
  // Events announce edges, not history. Re-read both resources after a reconnect or a shed frame.
  onCleanup(wsOnReconnect(refresh))

  // ── Somebody else pointed at a run ────────────────────────────────────────────────────────────
  //
  // A bell row, an attention row, the agent pane's chip, or the deep link `?pane=workflows&item=`,
  // which the host turns into a `plugin:select` naming the run.
  const applyIntent = (intent: PaneIntent | undefined): void => {
    if (intent?.kind === 'plugin:select') return void selectRun(intent.item)
    if (intent?.kind !== 'workflows:show-run') return
    selectRun(intent.runId)
    if (intent.stepId) setSelectedStepId(intent.stepId)
  }
  applyIntent(consumePaneIntent(task.id, WORKFLOWS_PANE_ID))
  onCleanup(clientEvents.on('presentation:pane-intent', (event) => {
    if (event.taskId !== task.id || event.paneId !== WORKFLOWS_PANE_ID) return
    consumePaneIntent(event.taskId, event.paneId)
    applyIntent(event.intent)
  }))

  // ── The four verbs ────────────────────────────────────────────────────────────────────────────
  //
  // Each one refetches rather than guessing: the node answers `{ ok }` and the rows it moved are the
  // truth. In flight, every control is disabled, so a double press cannot approve twice.
  const act = async (fallback: string, run: () => Promise<{ ok?: boolean; error?: string }>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const answer = await run()
      if (answer?.error) setError(answer.error)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback)
    } finally {
      setBusy(false)
      void refetchSteps()
      void refetchRuns()
    }
  }

  return {
    task,
    runs,
    steps,
    nodes,
    selectedRun,
    selectedStep,
    selectedRunId,
    selectedStepId,
    selectRun,
    selectStep: (stepId: string) => setSelectedStepId(stepId),
    now,
    busy,
    error,
    setError,
    /** What this step has said, newest last. Whatever the vocabulary does not name is kept as JSON. */
    eventsFor: (stepId: string): readonly unknown[] => events()[stepId] ?? [],
    /** The captured output of a command step while it runs, as lines. */
    tailFor: (stepId: string): readonly string[] => {
      const tail = tails()[stepId]
      return tail ? tail.split('\n') : []
    },
    refresh,
    gate: (approved: boolean) => {
      const run = selectedRunId()
      const step = selectedStepId()
      if (!run || !step) return Promise.resolve()
      return act('That gate could not be resolved.', () => workflowApi.gate(run, step, approved))
    },
    cancel: () => {
      const run = selectedRunId()
      if (!run) return Promise.resolve()
      return act('That run could not be cancelled.', () => workflowApi.cancel(run))
    },
    kill: (stepId: string) => {
      const run = selectedRunId()
      if (!run) return Promise.resolve()
      return act('That step could not be stopped.', () => workflowApi.kill(run, stepId))
    },
    retry: (stepId: string, prompt?: string) => {
      const run = selectedRunId()
      if (!run) return Promise.resolve()
      return act('That step could not be retried.', () => workflowApi.retry(run, stepId, prompt))
    },
  }
}
