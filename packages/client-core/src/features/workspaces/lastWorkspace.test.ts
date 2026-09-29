import { beforeEach, describe, expect, it } from 'vitest'
import { currentWorkspaceId, hydrateWorkspaceHistory, noteWorkspaceVisit, previousWorkspaceId } from './lastWorkspace'

describe('the last workspace', () => {
  beforeEach(() => hydrateWorkspaceHistory({ current: null, previous: null }))

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

  it('keeps the pair after hydration and counts a different startup destination as a visit', () => {
    hydrateWorkspaceHistory({ current: 'b', previous: 'a' })
    noteWorkspaceVisit('b')
    expect(previousWorkspaceId()).toBe('a')

    noteWorkspaceVisit('c')
    expect(currentWorkspaceId()).toBe('c')
    expect(previousWorkspaceId()).toBe('b')
  })
})
