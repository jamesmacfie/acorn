// Asks a policy until it answers `pass` or `fail`, or the timeout passes
// (docs/workflows/polling-gates.md). `gate-policy` and `ci-loop` both wait through it.
//
// The handler stays live for the whole wait. What it saves on the step row is what lets a restarted
// Node carry on with the same `since`, deadline and poll count instead of starting again.
import type { PolicyContext, PolicyVerdict } from '../../shared/workflowContracts'
import type { PolicyWaitRecord } from '../../shared/policyWait'

/** A broken token or a missing `gh` login fails the step after this many polls in a row, rather than
 *  waiting out a day-long timeout. */
const MAX_FAILED_POLLS = 3

export type PolicyWaitResult =
  | { verdict: 'pass' | 'fail' | 'timed-out'; detail?: string; value?: unknown; polls: number }
  | { error: string; polls: number }
  | { cancelled: true }

export type PolicyWaitOptions = {
  evaluate(ctx: PolicyContext): Promise<PolicyVerdict>
  taskId: string
  settings: Record<string, unknown>
  signal: AbortSignal
  /** Absent for a one-shot gate, which asks once and reads `wait` as `fail`. */
  timing?: { intervalMs: number; timeoutMs: number }
  /** The wait an earlier attempt saved, when a restart cut it short. */
  saved?: PolicyWaitRecord
  /** Writes the record onto the step row, or removes it with null. */
  save(record: PolicyWaitRecord | null): Promise<void>
  /** Runs the write that marks a poll as started under checkout admission. A Git write already holding
   *  the checkout finishes first, and one that comes later sees the checkout busy until the poll ends. */
  admit(write: () => Promise<void>): Promise<void>
  progress(text: string): void
  sleep(ms: number, signal: AbortSignal): Promise<void>
}

const VERDICTS = new Set<unknown>(['pass', 'wait', 'fail'])
const unknownVerdict = (answer: PolicyVerdict): string =>
  `The policy answered '${String(answer.verdict)}', which is not pass, wait, or fail.`

const message = (error: unknown): string => (error instanceof Error ? error.message : 'The policy check failed.')

const settled = (answer: PolicyVerdict, verdict: 'pass' | 'fail' | 'timed-out', polls: number) => ({
  verdict,
  ...(answer.detail !== undefined ? { detail: answer.detail } : {}),
  ...(answer.value !== undefined ? { value: answer.value } : {}),
  polls,
})

export async function waitForPolicy(options: PolicyWaitOptions): Promise<PolicyWaitResult> {
  const { evaluate, taskId, settings, signal, timing, saved } = options
  if (!timing) {
    try {
      const answer = await evaluate({ taskId, with: settings, since: Date.now(), signal })
      if (!VERDICTS.has(answer.verdict)) return { error: unknownVerdict(answer), polls: 1 }
      return settled(answer, answer.verdict === 'pass' ? 'pass' : 'fail', 1)
    } catch (error) {
      return signal.aborted ? { cancelled: true } : { error: message(error), polls: 1 }
    }
  }

  const started = Date.now()
  const since = saved?.since ?? started
  const deadlineAt = saved?.deadlineAt ?? started + timing.timeoutMs
  let polls = saved?.polls ?? 0
  // A saved wait only exists while the answer was `wait`, so that is what the last poll said.
  let previous: PolicyVerdict | undefined = saved
    ? { verdict: 'wait', ...(saved.detail !== undefined ? { detail: saved.detail } : {}) }
    : undefined
  let failures = 0
  const record = (state: PolicyWaitRecord['state'], nextPollAt?: number): PolicyWaitRecord => ({
    since,
    deadlineAt,
    polls,
    state,
    ...(previous?.detail !== undefined ? { detail: previous.detail } : {}),
    ...(nextPollAt !== undefined ? { nextPollAt } : {}),
  })

  for (;;) {
    if (signal.aborted) return { cancelled: true }
    let answer: PolicyVerdict | undefined
    try {
      await options.admit(() => options.save(record('polling')))
      answer = await evaluate({ taskId, with: settings, since, ...(previous ? { previous } : {}), signal })
      failures = 0
    } catch (error) {
      if (signal.aborted) return { cancelled: true }
      failures += 1
      polls += 1
      if (failures >= MAX_FAILED_POLLS) {
        await options.save(null)
        return { error: message(error), polls }
      }
      options.progress(`The check failed, so it will try again: ${message(error)}`)
    }
    if (answer) {
      polls += 1
      // A contributed policy, or an agent's reply, can say anything. Only the three answers end or
      // extend a wait, so anything else fails the step rather than being read as one of them.
      if (!VERDICTS.has(answer.verdict)) {
        await options.save(null)
        return { error: unknownVerdict(answer), polls }
      }
      if (answer.verdict !== 'wait') {
        await options.save(null)
        return settled(answer, answer.verdict, polls)
      }
      previous = answer
      options.progress(answer.detail ?? 'Waiting')
    }
    const now = Date.now()
    if (now >= deadlineAt) {
      await options.save(null)
      return settled(previous ?? { verdict: 'wait' }, 'timed-out', polls)
    }
    // The last poll lands on the deadline itself, so a condition that turns true in the final
    // interval still counts.
    const nextPollAt = Math.min(now + timing.intervalMs, deadlineAt)
    await options.save(record('sleeping', nextPollAt))
    await options.sleep(nextPollAt - now, signal)
  }
}
