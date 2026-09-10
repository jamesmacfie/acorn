import { z } from 'zod'
import { emitEvent, telemetryEnabled } from '@acorn/node-core/server/telemetry/collector.ts'

const pulseSchema = z.object({
  active: z.boolean(),
  activity: z.object({
    owner: z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/),
    operation: z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/),
    traceId: z.string().regex(/^[a-f0-9]{32}$/),
    spanId: z.string().regex(/^[a-f0-9]{16}$/),
  }).nullable(),
})

/** Per connection, so a closed/replaced window cannot be reported as a hung one. */
export function createRendererWatchdog(options: {
  now?: () => number
  enabled?: () => boolean
  report?: (name: string, attrs: Record<string, string | number | boolean>) => void
} = {}) {
  const now = options.now ?? (() => performance.now())
  const enabled = options.enabled ?? telemetryEnabled
  const report = options.report ?? ((name, attrs) => emitEvent(typeof attrs.owner === 'string' ? attrs.owner : 'core', name, attrs))
  let pulse: z.infer<typeof pulseSchema> | null = null
  let last = now()
  let tickAt = last
  let reported = false
  let context: z.infer<typeof pulseSchema>['activity'] = null
  let contextAt = 0
  const attrs = () => context ? { ...context, contextAgeMs: now() - contextAt, operationActive: pulse?.activity !== null } : {}
  const reset = () => { pulse = null; context = null; reported = false; last = now() }
  return {
    receive(raw: unknown): void {
      const parsed = pulseSchema.safeParse(raw)
      if (!parsed.success) return
      if (!enabled() || !parsed.data.active) { reset(); return }
      if (reported) report('ui.hang.recovered', { durationMs: now() - last, ...attrs() })
      if (parsed.data.activity && parsed.data.activity.spanId !== context?.spanId) {
        context = parsed.data.activity
        contextAt = now()
      }
      pulse = parsed.data
      last = now()
      reported = false
    },
    tick(): void {
      const at = now()
      const suspended = at - tickAt > 5000
      tickAt = at
      // Helper starvation and laptop sleep cannot establish a renderer-only hang. Re-arm on a pulse.
      if (!enabled() || suspended) { reset(); return }
      if (!pulse || reported || at - last < 5000) return
      reported = true
      report('ui.hang.suspected', { durationMs: at - last, ...attrs() })
    },
    reset,
  }
}
