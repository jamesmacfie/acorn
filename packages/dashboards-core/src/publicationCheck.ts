import type { DashboardPanelContent } from '@acorn/protocol/dashboards.ts'
import { DATA_SOURCE_PREVIEW_MODE } from '@acorn/protocol/dataSources.ts'
import type { DashboardDisplayField } from './display'
import { viewsForSchema } from './model'
import { projectDashboardPanel, type DashboardQueryProjection } from './typedProjection'

// What publication refuses. The panel is projected over its described sources with no records, which
// is enough: the projected schema depends on the descriptions and the mapping, never on the rows.

/** One thing wrong with a panel. `path` is a JSON Pointer into `DashboardPanelContent`. */
export type DashboardProblem = { path: string; message: string }

export type DescribedDashboardQuery = Omit<DashboardQueryProjection, 'result'>

const escape = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1')

const VIEW_NEEDS: Record<string, string> = {
  board: 'A board needs a status or another field with a fixed set of values.',
  chart: 'A chart needs a status, category, or date field.',
}

export function checkDashboardPanel(
  content: DashboardPanelContent,
  queries: readonly DescribedDashboardQuery[],
): DashboardProblem[] {
  const problems: DashboardProblem[] = []
  const previews = queries.map((query): DashboardQueryProjection => ({
    ...query,
    result: {
      records: [], revision: query.description.revision, readTime: 0,
      completeness: { kind: 'complete' }, mode: DATA_SOURCE_PREVIEW_MODE, evaluationTime: 0,
    },
  }))
  const { schema } = projectDashboardPanel(content, previews)
  const byId = new Map(schema.fields.map(field => [field.id, field]))
  const display = content.display

  display.fields.forEach((ref, index) => {
    if (!byId.has(ref)) {
      problems.push({ path: `/display/fields/${index}`, message: `"${ref}" isn't a field this panel's queries provide. Choose the visible fields again.` })
    }
  })
  if (display.groupBy !== undefined && !byId.has(display.groupBy)) {
    problems.push({ path: '/display/groupBy', message: `The panel groups by "${display.groupBy}", which isn't a field its queries provide. Group by one of the panel's fields instead.` })
  }

  const view = display.view
  if (!viewsForSchema(schema).includes(view.kind)) {
    problems.push({ path: '/display/view/kind', message: `${VIEW_NEEDS[view.kind] ?? `This panel can't draw a ${view.kind}.`} Map one or pick another view.` })
  }

  const option = (key: 'field' | 'x' | 'series', fits: (field: DashboardDisplayField) => boolean, wants: string): void => {
    const ref = view[key]
    if (ref === undefined) return
    const field = byId.get(ref)
    if (!field) problems.push({ path: `/display/view/${key}`, message: `The view's ${key} names "${ref}", which isn't a field this panel's queries provide.` })
    else if (!fits(field)) problems.push({ path: `/display/view/${key}`, message: `The view's ${key} is ${field.name}, a ${field.type} field. It needs ${wants}.` })
  }
  const aggregate = view.aggregate ?? 'count'
  if (aggregate !== 'count' && view.field === undefined) {
    problems.push({ path: '/display/view/field', message: `A ${aggregate} needs a number field to measure.` })
  }
  option('field', field => field.type === 'number', 'a number field')
  const axis = view.shape === 'bar' ? ['enum'] : view.shape === 'line' ? ['datetime'] : ['enum', 'datetime']
  option('x', field => axis.includes(field.type), view.shape === 'line' ? 'a date field' : view.shape === 'bar' ? 'a field with a fixed set of values' : 'a date field or one with a fixed set of values')
  option('series', field => field.type === 'enum', 'a field with a fixed set of values')

  for (const query of queries) {
    const described = new Set(query.description.fields.map(field => field.pointer))
    for (const [role, pointer] of Object.entries(content.mapping.fields[query.instanceId] ?? {})) {
      if (pointer && !described.has(pointer)) {
        problems.push({
          path: `/mapping/fields/${escape(query.instanceId)}/${role}`,
          message: `${query.label} maps ${role} to "${pointer}", which its source doesn't describe. Map ${role} again.`,
        })
      }
    }
  }
  return problems
}

export const describeDashboardProblem = (problem: DashboardProblem): string => `${problem.path}: ${problem.message}`
