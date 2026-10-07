// What the node half reads and changes, apart from the transport. `meter.test.mjs` checks the rules.

const SHOWN_SESSIONS = 4

/** The task's live sessions, newest first, each with its rebuilt activity and its effort option. */
export async function taskActivity({ sessions, activity }, taskId) {
  const roster = (await sessions.list(taskId))
    .filter((entry) => entry.present && !entry.archived)
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SHOWN_SESSIONS)
  return {
    sessions: await Promise.all(roster.map(async (entry) => ({
      sessionId: entry.sessionId,
      title: entry.title,
      providerId: entry.providerId,
      runtimeState: entry.runtimeState,
      effort: effortOf(entry.configOptions),
      activity: await activity.read({ taskId, sessionId: entry.sessionId }),
    }))),
  }
}

const effortOption = (options) => (options ?? []).find((option) => option.category === 'reasoning' && option.values?.length > 1)

export function effortOf(options) {
  const option = effortOption(options)
  if (!option) return null
  const current = option.values.find((value) => value.value === option.currentValue)
  return { optionId: option.id, label: option.label, value: option.currentValue, valueLabel: current?.label ?? option.currentValue }
}

/** The advertised value after the current one, wrapping. `null` when the harness offers no choice. */
export function nextEffort(options) {
  const option = effortOption(options)
  if (!option) return null
  const at = option.values.findIndex((value) => value.value === option.currentValue)
  const next = option.values[(at + 1) % option.values.length]
  return { optionId: option.id, value: next.value, valueLabel: next.label }
}
