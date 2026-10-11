import type { AgentAttendance, AgentSession, AgentTurnSource } from '../../contract/wire.ts'

export type Attendance = AgentAttendance
export type WorkflowPosture = 'gated' | 'autonomous'
export type TurnAttendanceContext = { posture?: WorkflowPosture; originTurnId?: string }

export const AUTONOMOUS_REQUEST_MESSAGE =
  'This run is unattended. Proceed with a reversible assumption or end with BLOCKED: and name the decision needed.'

export function persistedAttendance(
  policy: Record<string, unknown>,
  legacy?: { session: AgentSession; source: AgentTurnSource },
): Attendance {
  const value = policy.attendance
  // Legacy sessions without a host snapshot default to their original supervised/attended behavior.
  if (value === undefined && legacy) {
    resolveAttendance(legacy.session, legacy.source)
    return sessionAttendance(legacy.session)
  }
  if (value === 'attended' || value === 'supervised' || value === 'autonomous') return value
  throw new Error(`Invalid persisted turn attendance: ${String(value)}`)
}

/** Only the host passes posture. Policy JSON from clients and tools is never an attendance source. */
export function resolveAttendance(
  session: Pick<AgentSession, 'kind'>,
  source: AgentTurnSource,
  posture?: WorkflowPosture,
): Attendance {
  if (posture !== undefined && posture !== 'gated' && posture !== 'autonomous') {
    throw new Error(`Unknown workflow posture: ${String(posture)}`)
  }
  if (source === 'goal' && session.kind !== 'interactive') throw new Error('Goals require an interactive session.')
  if (!['interactive', 'imported', 'workflow', 'delegated'].includes(session.kind))
    throw new Error(`Unknown session kind: ${String(session.kind)}`)
  if (session.kind === 'workflow') return posture === 'autonomous' ? 'autonomous' : 'supervised'
  if (posture !== undefined) throw new Error('Workflow posture requires a workflow session.')
  return session.kind === 'delegated' ? 'supervised' : 'attended'
}

/** Host-owned bootstrap instructions for channels that are fixed when the provider session starts. */
export function sessionAttendance(session: AgentSession): Attendance {
  return session.config.initialAttendance === undefined
    ? resolveAttendance(session, 'interactive')
    : persistedAttendance({ attendance: session.config.initialAttendance })
}
