import type { AgentAttendance, AgentSession } from '../../contract/wire.ts'

/** Capture the host and provider facts once, including turns accepted directly by the store. */
export function effectiveTurnPolicy(
  session: AgentSession,
  requested: Record<string, unknown>,
  attendance: AgentAttendance,
  capturedAt: number,
): Record<string, unknown> & { attendance: AgentAttendance } {
  const options = Array.isArray(session.config.configOptions)
    ? (session.config.configOptions as Array<{
        id?: unknown
        label?: unknown
        category?: unknown
        currentValue?: unknown
      }>)
    : []
  const providerAdvertisedPolicy = options.flatMap((option) =>
    typeof option.id === 'string' &&
    typeof option.category === 'string' &&
    ['permission', 'mode', 'model', 'reasoning'].includes(option.category)
      ? [
          {
            id: option.id,
            label: typeof option.label === 'string' ? option.label : option.id,
            category: option.category,
            value: typeof option.currentValue === 'string' ? option.currentValue : null,
          },
        ]
      : [],
  )
  return {
    ...requested,
    attendance,
    providerAdvertisedPolicy,
    providerStatusAuthority: session.statusAuthority,
    capturedAt,
  }
}
