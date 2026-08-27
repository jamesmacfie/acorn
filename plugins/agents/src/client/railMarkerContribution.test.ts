import { describe, expect, it } from 'vitest'
import { agentRailMarkers } from './railMarkerContribution'

describe('agentRailMarkers', () => {
  it('says nothing about a task with no agents in it', () => {
    expect(agentRailMarkers({ working: 0, attention: 0 })).toEqual([])
  })

  it('turns a loader in the top-right corner while an agent is working', () => {
    const [marker] = agentRailMarkers({ working: 1, attention: 0 })
    expect(marker).toMatchObject({
      id: 'working', label: '1 agent working', icon: 'loader-circle', busy: true, placements: ['top-end'],
    })
  })

  it('replaces the loader outright once an agent needs the owner', () => {
    const markers = agentRailMarkers({ working: 3, attention: 1 })
    expect(markers.map((m) => m.id)).toEqual(['attention'])
    expect(markers[0]).toMatchObject({ label: '1 agent needs you', icon: 'circle-alert', placements: ['top-end'] })
    // Not busy: a blocked agent is not moving, and a spinner on it reads as progress.
    expect(markers[0]!.busy).toBeUndefined()
  })

  it('counts agents in the label rather than saying the same thing for two as for ten', () => {
    expect(agentRailMarkers({ working: 4, attention: 0 })[0]!.label).toBe('4 agents working')
    expect(agentRailMarkers({ working: 0, attention: 2 })[0]!.label).toBe('2 agents need you')
  })
})
