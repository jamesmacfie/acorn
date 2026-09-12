import { describe, expect, it } from 'vitest'
import { noteWorkspaceVisit, previousWorkspaceId } from './lastWorkspace'

// One sequence rather than a case each: the store is module state with no reset, which is the point
// — it outlives every component that reports to it.
describe('the last workspace', () => {
  it('bounces between the two most recent workspaces', () => {
    expect(previousWorkspaceId()).toBe(null)

    // Nothing to go back to until a second workspace has been opened.
    noteWorkspaceVisit('a')
    expect(previousWorkspaceId()).toBe(null)

    noteWorkspaceVisit('b')
    expect(previousWorkspaceId()).toBe('a')

    // Re-reporting the open workspace is what every host does on each render of its derivation.
    noteWorkspaceVisit('b')
    expect(previousWorkspaceId()).toBe('a')

    // Going back makes the one we left the way back, so the key keeps swapping the same pair.
    noteWorkspaceVisit('a')
    expect(previousWorkspaceId()).toBe('b')
    noteWorkspaceVisit('b')
    expect(previousWorkspaceId()).toBe('a')

    // A third workspace displaces the pair rather than joining a history.
    noteWorkspaceVisit('c')
    expect(previousWorkspaceId()).toBe('b')
  })
})
