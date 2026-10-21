import { describe, expect, it } from 'vitest'
import { starterTriggerCheck } from './starterTriggers'

const description = {
  schema: {
    type: 'object' as const,
    properties: { status: { type: 'string' as const, enum: ['open', 'failed'] }, load: { type: 'number' as const } },
  },
  fields: [
    {
      pointer: '/status',
      label: 'Status',
      origin: 'declared' as const,
      query: { operators: ['eq' as const], sortable: false },
      choices: {
        kind: 'static' as const,
        values: [
          { id: 'open', label: 'Open' },
          { id: 'failed', label: 'Failed' },
        ],
      },
    },
    { pointer: '/load', label: 'Load', origin: 'declared' as const },
  ],
  operations: { query: true as const, options: false, details: false, incremental: false, groups: ['all' as const] },
}
const where = (pointer: string, operator: string, value: unknown) => ({
  kind: 'comparison',
  left: { address: { from: 'item', pointer } },
  operator,
  right: { address: { from: 'literal', value } },
})

describe('starterTriggerCheck', () => {
  it('keeps a starter whose predicate and fields the source supports', () => {
    const starter = {
      id: 'fails',
      label: 'A deploy fails',
      description: 'Starts when a deploy fails.',
      predicate: where('/status', 'eq', 'failed'),
      change: { on: 'enters' },
    }
    expect(starterTriggerCheck(description, [starter])).toEqual({ kept: [starter], dropped: [] })
  })

  it('drops a starter with a reason for each problem', () => {
    const { kept, dropped } = starterTriggerCheck(description, [
      { id: 'a', label: 'A', description: 'A', predicate: where('/owner', 'eq', 'me'), change: { on: 'new' } },
      { id: 'b', label: 'B', description: 'B', predicate: where('/load', 'gt', 4), change: { on: 'new' } },
      { id: 'c', label: 'C', description: 'C', predicate: where('/status', 'eq', 'closed'), change: { on: 'new' } },
      { id: 'd', label: 'D', description: 'D', change: { on: 'changes', fields: ['/cpu'] } },
      { id: 'd', label: 'D', description: 'D', change: { on: 'new' } },
      { id: 'e', label: 'E', change: { on: 'new' } },
    ])
    expect(kept).toEqual([])
    expect(dropped).toEqual([
      { id: 'a', problems: ["The predicate names /owner, which the source doesn't describe."] },
      { id: 'b', problems: ['The source can\'t filter /load with "gt".'] },
      { id: 'c', problems: ['"closed" isn\'t a value of /status.'] },
      { id: 'd', problems: ["The watched field /cpu isn't one the source describes."] },
      { id: 'd', problems: ['Another starter has the same id.'] },
      { id: 'e', problems: [expect.stringContaining('description')] },
    ])
  })
})
