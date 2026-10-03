/** The closed vocabulary shared by validation, forms, and dashboard authoring. */
export const PANEL_CAPABILITIES = {
  operations: [{
    id: 'filter',
    label: 'Keep matching rows',
    description: 'Keep rows whose panel columns meet all or any typed comparisons.',
    example: { op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/state' } }, operator: 'eq', right: { address: { from: 'literal', value: 'open' } } } },
  }],
  units: ['percent', 'ms', 's', 'bytes', 'ISO 4217 currency'],
  precisions: ['instant', 'day'],
  buckets: ['value', 'day', 'week', 'month', 'relative'],
  groupOrders: ['declared', 'label', 'count', 'explicit'],
  views: {
    stat: { needs: [], options: ['aggregate', 'field', 'trend', 'compare', 'good'] },
    list: { needs: [], options: [] },
    table: { needs: [], options: [] },
    board: { needs: ['enum group'], options: [] },
    chart: { needs: ['date or enum axis'], options: ['shape', 'x', 'series'] },
  },
} as const
