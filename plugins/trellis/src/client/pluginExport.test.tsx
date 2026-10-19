import { expect, it } from 'vitest'
import type { NodePluginRow } from '@acorn/protocol/api.ts'
import { pluginRequirements } from './pluginExport'

const plan = (...pluginIds: string[]) => ({
  sources: pluginIds.map((pluginId) => ({
    reference: { kind: 'inline', content: { query: { source: { pluginId, sourceId: 'items' } } } },
  })),
})
const row = (name: string, version?: string) =>
  ({ name, ...(version ? { installed: { version } } : {}) }) as NodePluginRow

it("names each plugin behind an app's sources once, with its running major as the range", () => {
  const plans = { open: plan('linear', 'core'), done: plan('linear', 'agents'), mine: plan('gone') }
  expect(pluginRequirements(plans, [row('agents'), row('linear', '2.4.1'), row('github', '1.0.0')])).toEqual([
    // A compiled plugin has no version to hold it to.
    { id: 'agents' },
    { id: 'linear', version: '2' },
  ])
})
