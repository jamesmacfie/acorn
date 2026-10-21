import { defineEventFeed, field } from 'acorn-plugin-sdk/data'

// #region feed
// Acorn stores what the plugin appends and serves it as a source, so triggers, panels, and workflow
// steps read load alerts like any other records. Each event carries a `time` that acorn adds as a field.
export const alerts = defineEventFeed({
  id: 'alerts',
  name: 'Load alerts',
  singular: 'Alert',
  plural: 'Alerts',
  fields: {
    host: field.text({ label: 'Host', role: 'title' }),
    load: field.number({ label: 'Load' }),
  },
  // #region starter
  // The trigger dialog offers this first. The person still picks the workflow and its inputs.
  starterTriggers: [
    {
      id: 'high-load',
      label: 'A host’s load goes above 4',
      description: 'Starts a run for each load alert above 4.',
      predicate: {
        kind: 'comparison',
        left: { address: { from: 'item', pointer: '/load' } },
        operator: 'gt',
        right: { address: { from: 'literal', value: 4 } },
      },
      change: { on: 'new' },
    },
  ],
  // #endregion
})
// #endregion
