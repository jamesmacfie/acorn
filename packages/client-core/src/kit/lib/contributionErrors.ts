// Where a contribution that threw while rendering is reported to, and the one seam `kit/` has for
// saying so.
//
// An installed handler rather than a direct call, because `kit/` is pure presentation: it is what
// `@acorn/plugin-api/ui` re-exports, and `tools/arch/boundaries.test.ts` holds its import edges to
// `kit/` and the highlighter. A boundary that imported the telemetry emitter would pull the emitter
// into every plugin bundle that draws a button. The same trade `host/frames/broker.ts` makes with
// its services, for the same reason.
//
// Nothing is installed by default, so a host that never starts telemetry pays one null check.

export type ContributionErrorHandler = (report: { contributionId: string; owner?: string; error: unknown }) => void

let handler: ContributionErrorHandler | null = null

/** Called by the client's telemetry start-up. One handler; a second replaces the first. */
export const setContributionErrorHandler = (next: ContributionErrorHandler | null): void => {
  handler = next
}

/** Say that a contribution threw. Never throws itself: an error boundary that failed while
 *  reporting a failure would take the fallback down with it. */
export const reportContributionError = (report: { contributionId: string; owner?: string; error: unknown }): void => {
  try {
    handler?.(report)
  } catch {
    // Deliberately silent, for the reason above.
  }
}
