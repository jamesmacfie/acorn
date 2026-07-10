import { describe, expect, it } from 'vitest'
import type { TaskContext } from './api'
import { formatContextBlock } from './contextBlock'

const ctx: TaskContext = {
  task: { id: 't1', title: 'fix: guard null token', repo: 'acme/api', branch: 'fix/null-token', worktreePath: null, pullNumber: 813 },
  sections: [
    { id: 'pr', label: 'PR', defaultIncluded: false, budget: { overflow: 'truncate-tail' }, items: [], compact: '## PR #813: fix\nGuards the token.', omitted: 0 },
    { id: 'notes', label: 'Notes', defaultIncluded: true, budget: { overflow: 'truncate-tail' }, items: [], compact: '## Notes\n### Plan\nDo the thing.', omitted: 0 },
  ],
  issues: [],
  notes: [],
  memory: [],
}

describe('formatContextBlock', () => {
  it('renders contribution-owned compact blocks in registry order', () => {
    expect(formatContextBlock(ctx)).toBe(`# Task: fix: guard null token (acme/api · fix/null-token)

## PR #813: fix
Guards the token.

## Notes
### Plan
Do the thing.`)
  })

  it('omits empty compact projections', () => {
    expect(formatContextBlock({ ...ctx, sections: ctx.sections.map((section) => ({ ...section, compact: '' })) })).toBe(
      '# Task: fix: guard null token (acme/api · fix/null-token)',
    )
  })
})
