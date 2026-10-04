/** The closed vocabulary shared by validation, forms, and dashboard authoring. */
export const PANEL_CAPABILITIES = {
  operations: [{
    id: 'filter',
    label: 'Keep matching rows',
    description: 'Keep rows whose panel columns meet all or any typed comparisons.',
    example: { op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/state' } }, operator: 'eq', right: { address: { from: 'literal', value: 'open' } } } },
  },
  { id: 'compute', label: 'Calculate columns', description: 'Calculate typed values from columns, literals, or the evaluation clock.', example: { op: 'compute', columns: [{ id: 'rate', label: 'Rate', expression: { kind: 'arithmetic', operator: 'divide', left: { kind: 'column', column: 'failures' }, right: { kind: 'column', column: 'runs' } } }] } },
  { id: 'summarize', label: 'Summarize rows', description: 'Group rows and calculate named measures, each with its own optional filter.', example: { op: 'summarize', by: [{ column: 'repository' }], measures: [{ id: 'count', label: 'Count', kind: 'count' }] } },
  { id: 'expand', label: 'Expand a list', description: 'Make one row per list item within the expansion budgets.', example: { op: 'expand', column: 'children', output: 'child', perRow: 100 } },
  { id: 'overlap', label: 'Find overlaps', description: 'Make one row per intersecting pair of time intervals.', example: { op: 'overlap', start: 'start', end: 'end', maxPairs: 5000 } }],
  relations: ['implements', 'blocks', 'belongs-to', 'references', 'equivalence'],
  cardinalities: ['one-to-one', 'many-to-one', 'one-to-many'],
  measures: ['count', 'count-where', 'sum', 'average', 'minimum', 'maximum', 'median', 'percentile', 'distinct-count', 'distinct-list', 'earliest', 'latest'],
  units: ['percent', 'ms', 's', 'bytes', 'ISO 4217 currency'],
  precisions: ['instant', 'day'],
  buckets: ['value', 'day', 'week', 'month', 'relative'],
  groupOrders: ['declared', 'label', 'count', 'explicit'],
  boardWrites: { path: '/columns/<columnId>/choices/<choiceId>/writeValues/<sourceId>',
    description: 'A source-declared writable enum field may set one exact provider value per choice and source. A missing mapping leaves that drop unavailable.' },
  views: {
    stat: { needs: [], options: ['aggregate', 'field', 'trend', 'compare', 'good'] },
    list: { needs: [], options: [] },
    table: { needs: [], options: [] },
    board: { needs: ['enum group'], options: [] },
    chart: { needs: ['date or enum axis'], options: ['shape', 'x', 'series'] },
  },
} as const
