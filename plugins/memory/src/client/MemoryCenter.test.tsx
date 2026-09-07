import { describe, expect, it } from 'vitest'
import type { MemoryProposalRow } from './memoryClient'
import { proposalsForProject } from './MemoryCenter'

// What the Memory page shows for the project it is routed to. A `.test.tsx` rather than `.test.ts`
// because the module it imports reaches the router and the UI kit, which only the jsdom project can
// resolve; the function under test is pure.

const proposal = (id: string, projectId: string | null): MemoryProposalRow => ({
  id, taskId: 't1', projectId, name: id, type: 'convention', description: '', body: '',
  flags: [], status: 'pending', createdAt: 0,
})

describe('proposalsForProject', () => {
  const rows = [proposal('here', 'proj-1'), proposal('elsewhere', 'proj-2'), proposal('unscoped', null)]

  it('keeps the routed project’s own, and drops another project’s', () => {
    expect(proposalsForProject(rows, 'proj-1').map((row) => row.id)).toEqual(['here', 'unscoped'])
  })

  it('keeps an unscoped proposal in every project, since no project would ever claim it', () => {
    // The node proposes with a null project when the agent's task will not resolve, so that a
    // reviewer still sees it (../server/agentTools.ts). Scoping it away would be the one place it
    // could have been reviewed from.
    expect(proposalsForProject(rows, 'proj-2').map((row) => row.id)).toEqual(['elsewhere', 'unscoped'])
  })

  it('shows everything when no project is routed', () => {
    expect(proposalsForProject(rows, undefined)).toHaveLength(3)
  })
})
