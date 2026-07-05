// Serve-then-revalidate helpers: routes answer from the local mirror and kick the refresh off
// here, fire-and-forget, in the long-lived Node process. Failures are logged, never surfaced —
// the stale response already went out. The set exists so tests can await completion via
// settleBackground(); production never awaits.
const background = new Set<Promise<unknown>>()

export const trackBackgroundRefresh = (label: string, promise: Promise<unknown>) => {
  const p = promise
    .catch((error) => console.error(`${label} background refresh failed`, error))
    .finally(() => background.delete(p))
  background.add(p)
}

export const settleBackground = () => Promise.all([...background])
