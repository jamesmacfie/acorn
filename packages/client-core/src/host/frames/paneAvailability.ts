// A loaded pane's `availability` route, held in memory for the pane's `when` gate
// (docs/panes/contributions.md § Contributions).
//
// `when` is synchronous and is asked while the pane strip is drawn, so the answer has to be here
// already. One node-wide read fills it, and the events below refresh it. Nothing reports a hand edit to
// a worktree file, so the schedule's interval and window focus pick that up.
import { createSignal } from 'solid-js'
import { readJson } from '../../infra/node/apiClient'
import { wsOnReconnect } from '../../infra/node/wsClient'
import { clientEvents } from '../registries/commands/clientEvents'
import type { ClientScheduleContribution } from '../registries/shell/schedules'
import { createLogger } from '../../infra/telemetry/logger'

const log = createLogger('pane-availability')

const isAnswer = (value: unknown): value is Record<string, boolean> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.values(value).every((entry) => typeof entry === 'boolean')

const same = (a: Record<string, boolean>, b: Record<string, boolean>): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

export function paneAvailability(scheduleId: string, route: string): {
  available: (taskId: string) => boolean
  schedule: ClientScheduleContribution
} {
  // Null when the node has no answer to give: a 404 is a plugin build older than the route. The pane
  // then shows on every task, as it did before it declared one, rather than vanishing.
  const [answer, setAnswer] = createSignal<Record<string, boolean> | null>({})
  return {
    available: (taskId) => {
      const current = answer()
      return current === null || current[taskId] === true
    },
    schedule: {
      id: scheduleId,
      intervalMs: 120_000,
      run: async () => {
        let next: unknown
        try {
          next = await readJson<unknown>(route)
        } catch (error) {
          // Any failure other than a 404 keeps the last answer, so one dropped request does not
          // flicker the button.
          if ((error as { status?: number }).status === 404) setAnswer(null)
          return
        }
        if (!isAnswer(next)) {
          log.warn(`${route} did not answer { [taskId]: boolean }`, undefined, { 'schedule.id': scheduleId })
          return
        }
        // Same answer, same object: `when` is read on every pane-strip render.
        setAnswer((current) => (current && same(current, next) ? current : next))
      },
      subscribe: (refresh) => {
        const offs = [
          clientEvents.on('project:changed', refresh),
          // Only a task the answer has not seen can change it. Status and title changes cannot.
          clientEvents.on('tasks:changed', ({ taskId }) => {
            const current = answer()
            if (taskId === null || (current !== null && !(taskId in current))) refresh()
          }),
          clientEvents.on('runtime:node-switched', refresh),
          wsOnReconnect(refresh),
        ]
        return () => offs.forEach((off) => off())
      },
    },
  }
}
