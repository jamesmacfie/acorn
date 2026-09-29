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

const [configured, setConfigured] = createSignal<Record<string, boolean>>({})

export const previewConfigured = (taskId: string): boolean => configured()[taskId] === true

const same = (a: Record<string, boolean>, b: Record<string, boolean>): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

export const previewConfiguredSchedule: ClientScheduleContribution = {
  id: 'preview.configured',
  intervalMs: 120_000,
  requires: { seam: 'preview' },
  run: async () => {
    const next = await readJson<Record<string, boolean>>(previewConfiguredRoute).catch(() => null)
    // Same answer, same object: `when` is read on every pane-strip render.
    if (next) setConfigured((current) => (same(current, next) ? current : next))
  },
  subscribe: (refresh) => {
    const offs = [
      onPluginFrame('preview', pluginChannel('preview', 'url-changed'), refresh),
      clientEvents.on('project:changed', refresh),
      // Only a task this list has not seen can change the answer. Status and title changes cannot.
      clientEvents.on('tasks:changed', ({ taskId }) => {
        if (taskId === null || !(taskId in configured())) refresh()
      }),
      clientEvents.on('runtime:node-switched', refresh),
      wsOnReconnect(refresh),
    ]
    return () => offs.forEach((off) => off())
  },
}
