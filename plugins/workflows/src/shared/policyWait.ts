// What a waiting gate saves on its step row, and the limits on how often it asks
// (docs/workflows/polling-gates.md). The server writes it, the checkout activity reader
// and the run pane read it, so it lives here where both halves can import it.

export const DEFAULT_POLL_INTERVAL_MS = 60_000
export const MIN_POLL_INTERVAL_MS = 30_000

/** Saved under `policyWait` in the step's `inputs_json` while the wait is open, and removed once the
 *  policy settles, so a retry starts a fresh wait and a restart picks the old one up. */
export type PolicyWaitRecord = {
  since: number
  deadlineAt: number
  polls: number
  /** `polling` while a poll runs, `sleeping` between polls. Only a sleeping wait frees the checkout. */
  state: 'polling' | 'sleeping'
  detail?: string
  nextPollAt?: number
}

export function readPolicyWait(inputsJson: string | null | undefined): PolicyWaitRecord | undefined {
  if (!inputsJson) return undefined
  try {
    const wait = (JSON.parse(inputsJson) as { policyWait?: PolicyWaitRecord }).policyWait
    return wait && typeof wait.since === 'number' ? wait : undefined
  } catch {
    return undefined
  }
}
