import { describe, expect, it } from 'vitest'
import { branchReferenceCandidates } from './branchReferences'

describe('ticket candidates in branch names', () => {
  it.each([
    ['dayna/fast-6529-bug-right-clicking-in-budget-modal-opens-the-planner-885c', ['FAST-6529']],
    ['feature/FAST-6529', ['FAST-6529']],
    ['eng2-42_fix_ops-9', ['ENG2-42', 'OPS-9']],
    ['fast-6529-again-FAST-6529', ['FAST-6529']],
    ['123fast-6529/fast-6529abc', []],
    ['feature/no-ticket-885c', []],
    [null, []],
  ])('extracts complete identifiers from %s', (branch, expected) => {
    expect(branchReferenceCandidates(branch)).toEqual(expected)
  })
})
