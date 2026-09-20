import { z } from 'zod'
import { dataPointerSchema, type DataPredicate } from './dataBindings'

const instant = z.number().finite()
export const queryTimeWindowSchema = z.object({
  pointer: dataPointerSchema,
  window: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('absolute'), start: instant, end: instant }).strict(),
    z.object({ kind: z.literal('last-duration'), durationMs: z.number().positive().finite() }).strict(),
    z.object({ kind: z.literal('since-local-midnight'), timezone: z.string().refine(value => {
      try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
    }) }).strict(),
  ]),
}).strict()
export type QueryTimeWindow = z.infer<typeof queryTimeWindowSchema>

/** Calendar boundaries use the execution's frozen instant, including daylight-saving transitions. */
export function resolveQueryTimeWindow(input: QueryTimeWindow, evaluationTime: number): DataPredicate {
  const { pointer, window } = queryTimeWindowSchema.parse(input)
  instant.parse(evaluationTime)
  let start: number
  const end = window.kind === 'absolute' ? window.end : evaluationTime
  if (window.kind === 'absolute') start = window.start
  else if (window.kind === 'last-duration') start = evaluationTime - window.durationMs
  else {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: window.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const day = formatter.format(evaluationTime)
    // Find the first instant in today's local date. This also handles a skipped local midnight.
    let low = evaluationTime - 48 * 60 * 60 * 1000
    let high = evaluationTime
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2)
      if (formatter.format(middle) === day) high = middle
      else low = middle
    }
    start = high
  }
  if (start > end) throw new Error('Time window start exceeds end')
  return { kind: 'all', predicates: [
    { kind: 'comparison', left: { address: { from: 'item', pointer } }, operator: 'gte', right: { address: { from: 'literal', value: start } } },
    { kind: 'comparison', left: { address: { from: 'item', pointer } }, operator: 'lt', right: { address: { from: 'literal', value: end } } },
  ] }
}
