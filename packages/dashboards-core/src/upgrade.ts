import type { DashboardPanelContent, PanelPlan, PanelPlanColumn } from '@acorn/protocol/dashboards.ts'

/** A read-only projection of a version 1 revision. Callers must keep its original bytes and digest. */
export function upgradePanelContent(content: DashboardPanelContent): PanelPlan {
  const mapped = content.queries.length > 1 || content.mapping.columns.length > 0
    || Object.values(content.mapping.fields).some(fields => Object.keys(fields).length > 0)
  const roles = ['title', 'status', 'assignee', 'updated', 'url'] as const
  const columns: PanelPlanColumn[] = mapped
    ? roles.flatMap(role => content.queries.some(query => content.mapping.fields[query.id]?.[role]) ? [{
      id: role,
      label: role[0]!.toUpperCase() + role.slice(1),
      bind: Object.fromEntries(content.queries.flatMap(query => {
        const field = content.mapping.fields[query.id]?.[role]
        return field ? [[query.id, { field, ...(role === 'status' && content.mapping.values[query.id] ? { values: content.mapping.values[query.id] } : {}) }]] : []
      })),
      ...(role === 'status' && content.mapping.columns.length ? {
        type: 'enum' as const,
        choices: content.mapping.columns.map(choice => ({ id: choice.id, label: choice.label, ...(choice.tone ? { tone: choice.tone } : {}) })),
        unmatched: content.mapping.unmapped,
      } : {}),
    }] : [])
    : [...new Set(content.display.fields)].filter(field => /^\/[A-Za-z0-9_-]+$/.test(field)).map(field => ({
      id: field.slice(1), label: field.slice(1), bind: { [content.queries[0]!.id]: { field } },
    }))
  if (mapped) columns.push({
    id: 'source', label: 'Source', type: 'text',
    bind: Object.fromEntries(content.queries.map(query => [query.id, { value: query.label }])),
  })
  const toId = (reference: string | undefined): string | undefined => {
    if (!reference) return undefined
    const found = columns.find(column => column.id === reference || reference === `/${column.id}`)
    return found?.id
  }
  const { field: _field, x: _x, series: _series, ...view } = content.display.view
  return {
    version: 2,
    title: content.title,
    time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
    sources: content.queries.map(query => ({ ...query, role: 'primary' })),
    columns,
    stages: [],
    ...(toId(content.display.groupBy) ? { group: [{ column: toId(content.display.groupBy)!, bucket: 'value' }] } : {}),
    ...(content.display.limit ? { limit: content.display.limit } : {}),
    view: {
      ...view,
      ...(toId(content.display.view.field) ? { field: toId(content.display.view.field) } : {}),
      ...(toId(content.display.view.x) ? { x: toId(content.display.view.x) } : {}),
      ...(toId(content.display.view.series) ? { series: toId(content.display.view.series) } : {}),
    },
  }
}
