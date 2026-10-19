import { createSignal } from 'solid-js'
import {
  activeNodeId,
  onPluginFrame,
  readJson,
  wsOnReconnect,
  type ClientScheduleContribution,
} from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { APP_CHANGED_VERB, appsRoute, type AppListing } from '../shared/api'

// Every shown app on the active Node, for the Apps pane and its gate. A pane's `when` is synchronous,
// so the answer has to be in memory: one read fills it, and the Node's app-changed frame, sent when a
// head moves, reads it again. The interval is the backstop for a frame missed while another Node was
// active.

const [listing, setListing] = createSignal<{ nodeId: string | null; apps: AppListing[] }>({
  nodeId: null,
  apps: [],
})

/** This task's shown apps, newest change first. Empty until the first read answers. */
export const taskApps = (taskId: string): AppListing[] =>
  listing().nodeId === activeNodeId()
    ? listing()
        .apps.filter((app) => app.taskId === taskId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    : []

export async function refreshApps(): Promise<void> {
  const nodeId = activeNodeId()
  const apps = await readJson<AppListing[]>(appsRoute, { nodeId })
  if (activeNodeId() !== nodeId) return
  // Same answer, same object: the pane strip reads `when` on every render.
  setListing((current) =>
    current.nodeId === nodeId && JSON.stringify(current.apps) === JSON.stringify(apps) ? current : { nodeId, apps },
  )
}

export const appsSchedule: ClientScheduleContribution = {
  id: 'trellis.apps',
  intervalMs: 120_000,
  requires: { plugin: 'trellis' },
  run: refreshApps,
  subscribe: (refresh) => {
    const offFrame = onPluginFrame('trellis', pluginChannel('trellis', APP_CHANGED_VERB), refresh)
    const offReconnect = wsOnReconnect(refresh)
    return () => {
      offFrame()
      offReconnect()
    }
  },
}
