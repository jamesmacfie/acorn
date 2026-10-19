import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataBinding } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

type Field = DataSourceDescription['fields'][number]
export type FieldSpec = Omit<Field, 'pointer' | 'origin'> & {
  key: string
  type: 'string' | 'number' | 'boolean'
  nullable?: true
}

/** A description's record schema and its fields from one list, so the two can't drift. Every key is
 *  required, and a nullable one carries `null` rather than going missing. */
export function sourceShape(specs: readonly FieldSpec[]): Pick<DataSourceDescription, 'schema' | 'fields'> {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        specs.map(({ key, type, nullable }) => [key, { type: nullable ? [type, 'null'] : type }]),
      ),
      required: specs.map(({ key }) => key),
    },
    fields: specs.map(({ key, type: _type, nullable: _nullable, ...field }) => ({
      pointer: `/${key}`,
      origin: 'declared' as const,
      ...field,
    })),
  }
}

/** A starter's source: one of this plugin's, read inline. Its scope names no workspace, because the
 *  launcher moves a starter onto the scope the person picked (docs/data-sources.md). */
export const starterSource = (sourceId: string, label: string): PanelPlan['sources'][number] => ({
  id: sourceId,
  label,
  role: 'primary',
  reference: {
    kind: 'inline',
    bindings: {},
    content: {
      name: label,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sourceParameters: {},
      query: { source: { pluginId: 'agents', sourceId }, scope: { parameters: {} }, sort: [] },
    },
  },
})

/** A starter filter: `pointer` after a context instant, such as the start of this week. */
export const after = (pointer: string, right: DataBinding): PanelPlan['stages'][number] => ({
  op: 'filter',
  where: { kind: 'comparison', left: { address: { from: 'item', pointer } }, operator: 'gt', right },
})
