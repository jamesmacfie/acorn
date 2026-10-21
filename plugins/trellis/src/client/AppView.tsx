import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js'
import { CardFrame, PlanPanel } from '@acorn/plugin-api/ui/dashboards'
import { composeForAgent, readJson, taskById, writeJson } from '@acorn/plugin-api/client'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import { appStateRoute, type AppRevisionFiles } from '../shared/api'
import AppRuntime, { type AppHost, type AppPanelProps, type AppPlanRun, type AppState } from '../embed/AppRuntime'
import { createSavedState } from './appState'

// One revision of an app, running in the desktop or the terminal. `AppRuntime` bounds the program; this
// hands it the desktop's reach: its own plans, run under this device through the dashboard run route;
// the task it is drawn in; the data source action route; the window's browser; and the task's agent
// composer.

type RunRow = AppPlanRun['rows'][number] & { records?: unknown[] }

export type AppPlacement = 'card' | 'pane' | 'project' | 'dashboard'

export default function AppView(props: {
  appId: string
  /** The task it's drawn in. A project app has none, so it has no task to read or composer to fill. */
  taskId?: string
  workspaceId: string
  files: AppRevisionFiles
  nodeId: string
  readOnly: boolean
  placement: AppPlacement
  /** A dashboard's refreshes. Present on a dashboard, where the program's queries also follow the
   *  dashboard's rules: again on each refresh, and at each plan's own refresh interval. */
  refreshes?: Accessor<number>
}) {
  const inCard = props.placement === 'card'
  // A card's plans first run when it is first on screen, so a long conversation reads only what is
  // seen. A pane is on screen.
  const [visible, setVisible] = createSignal(!inCard)
  // The rows of each plan's last run, where a row action finds the record it acts on.
  const lastRows = new Map<string, RunRow[]>()

  const host: AppHost = {
    runPlan: async (name, inputs) => {
      const plan = props.files.plans[name] as PanelPlan
      const run = await writeJson<AppPlanRun & { rows: RunRow[] }>('/v1/core/dashboards/run', {
        method: 'POST',
        nodeId: props.nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'run',
          scope: { workspaceId: props.workspaceId },
          target: { kind: 'draft', content: plan },
          mode: 'execution',
          viewerZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          inputs,
        }),
      })
      lastRows.set(name, run.rows)
      return { plan, run }
    },
    task: async () => {
      if (!props.taskId) throw new Error('This app is open in a project, so there is no task to read.')
      const task = taskById(props.taskId)
      return { id: props.taskId, title: task?.title ?? '', branch: task?.branch ?? null }
    },
    compose: async (text) =>
      props.taskId
        ? composeForAgent(props.taskId, text)
        : { ok: false, reason: 'This app is open in a project, so there is no agent to ask. Edit it in a task.' },
    openUrl: (url) => void window.open(url, '_blank', 'noopener,noreferrer'),
    rowAction: async (plan, rowId, actionId) => {
      const row = lastRows.get(plan)?.find((candidate) => candidate.id === rowId)
      const action = row?.actions?.find((candidate) => candidate.id === actionId)
      const record = row?.records?.[0]
      if (!action || !record) throw new Error('That row has no such action.')
      const result = await writeJson<{ outcome: string; action?: { verb: string; url?: string } }>(
        '/v1/core/data-sources/act',
        {
          method: 'POST',
          nodeId: props.nodeId,
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ ref: record, actionId: action.id, confirmedRisk: action.risk }),
        },
      )
      const url = result.outcome === 'ready' && result.action?.verb === 'openUrl' ? result.action.url : undefined
      return { outcome: result.outcome, ...(url ? { url } : {}) }
    },
    loadState: async () =>
      (await readJson<{ state: AppState }>(appStateRoute(props.appId), { nodeId: props.nodeId })).state,
    saveState: (state) =>
      writeJson(appStateRoute(props.appId), {
        method: 'PUT',
        nodeId: props.nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state }),
      }),
  }
  // An older revision is read only and remembers nothing.
  const savedState = props.readOnly ? undefined : createSavedState(props.nodeId, props.appId, host.loadState)

  const Panel = (panel: AppPanelProps) => (
    <PlanPanel
      id={`${props.appId}:${panel.plan}`}
      plan={props.files.plans[panel.plan] as PanelPlan}
      workspaceId={props.workspaceId}
      inputs={panel.inputs}
      active={panel.active}
    />
  )

  // A dashboard's refreshes run every plan again, and each plan's own interval runs that plan.
  const [refreshes, setRefreshes] = createSignal<{ plans?: string[] }>({})
  if (props.refreshes) {
    createEffect(on(props.refreshes, () => setRefreshes({}), { defer: true }))
    for (const [name, plan] of Object.entries(props.files.plans)) {
      const seconds = (plan as { refresh?: unknown } | null)?.refresh
      if (typeof seconds !== 'number' || !(seconds > 0)) continue
      // The plan schema's floor, held here too, because a revision planted in the data root skipped it.
      const timer = setInterval(() => setRefreshes({ plans: [name] }), Math.max(30, seconds) * 1000)
      onCleanup(() => clearInterval(timer))
    }
  }

  return (
    <AppRuntime
      program={props.files.program}
      plans={Object.keys(props.files.plans)}
      readOnly={props.readOnly}
      host={host}
      placement={props.placement}
      active={visible}
      Panel={Panel}
      savedState={savedState}
      refreshes={props.refreshes ? refreshes : undefined}
      frame={inCard ? (app) => <CardFrame onVisible={setVisible}>{app}</CardFrame> : undefined}
    />
  )
}
