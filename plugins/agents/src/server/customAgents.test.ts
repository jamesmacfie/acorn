import { describe, expect, it } from 'vitest'
import { findCustomAgent, parseStoredCustomAgents, serializeCustomAgents } from '../shared/customAgents'
import { contributedCustomAgent } from './customAgents'

describe('custom agents', () => {
  it('keeps the readable rows of a stored list and drops a broken one rather than all of them', () => {
    const agents = parseStoredCustomAgents(JSON.stringify([
      { id: 'a1', name: 'Reviewer', providerId: 'codex', profileId: 'codex', options: {} },
      { id: 'a2', name: '', providerId: 'codex', profileId: 'codex' },
    ]))
    expect(agents.map((agent) => agent.id)).toEqual(['a1'])
    expect(parseStoredCustomAgents('not json')).toEqual([])
    // A plugin's agent is never written into the owner's row.
    expect(JSON.parse(serializeCustomAgents([...agents, { ...agents[0]!, id: 'p:x', source: { kind: 'plugin', pluginId: 'p' } }])))
      .toEqual([{ id: 'a1', name: 'Reviewer', providerId: 'codex', profileId: 'codex', options: {} }])
  })

  it('finds an agent by id or by its name in any case, which is how another agent names one', () => {
    const agents = parseStoredCustomAgents(JSON.stringify([{ id: 'a1', name: 'Bug reviewer', providerId: 'codex', profileId: 'codex' }]))
    expect(findCustomAgent(agents, 'a1')?.id).toBe('a1')
    expect(findCustomAgent(agents, ' bug REVIEWER ')?.id).toBe('a1')
    expect(findCustomAgent(agents, 'nobody')).toBeUndefined()
  })

  it('gives a plugin’s agent the profile its harness runs under', () => {
    const base = { id: 'p:a', pluginId: 'p', name: 'A', options: {} }
    // Claude Code is the one harness whose two persisted ids differ.
    expect(contributedCustomAgent({ ...base, providerId: 'claude' }).profileId).toBe('claude-code')
    expect(contributedCustomAgent({ ...base, providerId: 'p:cli' })).toMatchObject({
      providerId: 'p:cli', profileId: 'p:cli', source: { kind: 'plugin', pluginId: 'p' },
    })
  })
})
