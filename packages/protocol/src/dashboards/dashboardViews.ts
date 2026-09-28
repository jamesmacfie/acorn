import { z } from 'zod'

// Shared by loaded-plugin manifest validation and the full dashboard protocol. Keep this vocabulary
// independent of dashboard publication/query schemas so parsing a plugin manifest does not load the
// complete dashboard authoring contract.
export const dashboardViewKinds = ['stat', 'list', 'table', 'board', 'chart'] as const

const pointer = z.string().refine(value => value === '' || value.startsWith('/'), 'Expected a JSON Pointer')

export const dashboardViewSchema = z.object({
  kind: z.enum(dashboardViewKinds),
  aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max']).optional(),
  field: pointer.optional(),
  shape: z.enum(['bar', 'line']).optional(),
  x: pointer.optional(),
  series: pointer.optional(),
  trend: z.enum(['history', 'activity']).optional(),
  compare: z.enum(['day', 'week']).optional(),
  good: z.enum(['up', 'down']).optional(),
}).strict()

export type DashboardView = z.infer<typeof dashboardViewSchema>
