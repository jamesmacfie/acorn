import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataBinding, DataOperator } from '@acorn/protocol/dataBindings.ts'

type Plan = Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'>

/** Builders for one Linear source's starter plans. The scope names no account; the launcher adds it. */
export function starterPlans(sourceId: string, name: string) {
  const source: PanelPlan['sources'][number] = {
    id: sourceId,
    label: name,
    role: 'primary',
    reference: {
      kind: 'inline',
      bindings: {},
      content: {
        name,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        sourceParameters: {},
        query: { source: { pluginId: 'linear', sourceId }, scope: { parameters: {} }, sort: [] },
      },
    },
  }
  return {
    plan: (title: string, rest: Plan): PanelPlan => ({
      version: 2,
      title,
      time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
      sources: [source],
      ...rest,
    }),
    column: (
      id: string,
      label: string,
      type: PanelPlan['columns'][number]['type'],
      pointer = `/${id}`,
    ): PanelPlan['columns'][number] => ({ id, label, type, bind: { [sourceId]: { field: pointer } } }),
    filter: (pointer: string, operator: DataOperator, right: DataBinding): PanelPlan['stages'][number] => ({
      op: 'filter',
      where: { kind: 'comparison', left: { address: { from: 'item', pointer } }, operator, right },
    }),
  }
}
