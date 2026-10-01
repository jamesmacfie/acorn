// Which tasks have preview set up, so the pane and its command are hidden on the ones that do not.
//
// `when` on a pane is synchronous and is asked while the pane strip is drawn, so the answer has to be
// in memory already (client-core registries/panes/panes.ts). One node-wide read fills it, and the
// frames below refresh it. Nothing reports a hand edit to `.acorn/config.toml`, so the interval and
// window focus pick that up, as they do for the run-target buttons.
import { createSignal } from 'solid-js'
import { clientEvents, onPluginFrame, readJson, wsOnReconnect, type ClientScheduleContribution } from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { previewConfiguredRoute } from '../shared/api'

// Null when the Node has no answer to give: a build older than the route, which is what an
// unrestarted local Node or an out-of-date remote one is. It offers the pane on every task, as it did
// before this gate, rather than hiding preview on a Node that can still draw it.
const [configured, setConfigured] = createSignal<Record<string, boolean> | null>({})

export const previewConfigured = (taskId: string): boolean => {
  const answer = configured()
  return answer === null || answer[taskId] === true
}

const same = (a: Record<string, boolean>, b: Record<string, boolean>): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

export const previewConfiguredSchedule: ClientScheduleContribution = {
  id: 'preview.configured',
  intervalMs: 120_000,
  requires: { seam: 'preview' },
  run: async () => {
    let next: Record<string, boolean>
    try {
      next = await readJson<Record<string, boolean>>(previewConfiguredRoute)
    } catch (error) {
      // A 404 is a Node without the route. Any other failure keeps the last answer, so a dropped
      // request does not flicker the button.
      if ((error as { status?: number }).status === 404) setConfigured(null)
      return
    }
    // Same answer, same object: `when` is read on every pane-strip render.
    setConfigured((current) => (current && same(current, next) ? current : next))
  },
  subscribe: (refresh) => {
    const offs = [
      onPluginFrame('preview', pluginChannel('preview', 'url-changed'), refresh),
      clientEvents.on('project:changed', refresh),
      // Only a task this list has not seen can change the answer. Status and title changes cannot.
      clientEvents.on('tasks:changed', ({ taskId }) => {
        const answer = configured()
        if (taskId === null || (answer !== null && !(taskId in answer))) refresh()
      }),
      clientEvents.on('runtime:node-switched', refresh),
      wsOnReconnect(refresh),
    ]
    return () => offs.forEach((off) => off())
  },
}
