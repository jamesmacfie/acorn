import type { AgentInputPart, AgentNormalizedEvent } from '../../contract/wire.ts'

export const USAGE_CONTINUATION_GRACE_MS = 5_000

const LIMIT_CODE = /(?:usage|rate)[_-]?limit|quota/i
const LIMIT_MESSAGE = /(?:usage|rate|session|weekly) limit|usage window|quota (?:has been )?(?:reached|exceeded)|out of (?:plan )?usage/i

/** A broad provider-neutral hint. The usage collector is the authority that confirms depletion and
 * supplies the reset time, so matching an ordinary short rate limit here cannot schedule by itself. */
export function mayBeUsageLimit(event: AgentNormalizedEvent): event is Extract<AgentNormalizedEvent, { type: 'error' }> {
  return event.type === 'error' && (LIMIT_CODE.test(event.code) || LIMIT_MESSAGE.test(event.message))
}

export function usageContinuationInput(): AgentInputPart[] {
  return [{
    type: 'text',
    text: 'Continue the task you were working on when the usage limit was reached. Check the work already completed and do not repeat it.',
  }]
}

export function usageContinuationMessage(resumeAt: number): string {
  return `Usage limit reached. Acorn will continue this turn automatically at ${new Date(resumeAt).toLocaleString()}.`
}
