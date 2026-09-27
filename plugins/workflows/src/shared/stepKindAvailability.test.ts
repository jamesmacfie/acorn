import { describe, expect, it } from 'vitest'
import { stepKindContributionProblems, unavailableCatalogKind, unavailableStepKindMessage } from './stepKindAvailability'

describe('workflow step contribution availability', () => {
  it('rejects incomplete metadata and malformed fields without accepting a handler alone', () => {
    expect(stepKindContributionProblems({ handler: async () => ({ status: 'done' }) })).toContain('describe is required')
    expect(stepKindContributionProblems({
      handler: async () => ({ status: 'done' }),
      describe: { label: 'Send', icon: 'send', description: 'Send a message.', fields: [
        { id: 'target', label: 'Target', type: 'text' },
        { id: 'target', label: 'Target again', type: 'text' },
      ], output: { description: 'The sent message.' } },
    })).toContain("describe.fields has duplicate id 'target'")
  })

  it('accepts a complete description without a schema or semantic validator', () => {
    expect(stepKindContributionProblems({
      handler: async () => ({ status: 'done' }),
      describe: { label: 'Send', icon: 'send', description: 'Send a message.', fields: [], output: { description: 'The sent message.' } },
    })).toEqual([])
  })

  it('identifies a missing qualified kind without mistaking catalog loading for plugin loss', () => {
    expect(unavailableCatalogKind('mail:send', undefined)).toBe(false)
    expect(unavailableCatalogKind('mail:send', { kinds: [], policies: [], profiles: [] })).toBe(true)
    expect(unavailableStepKindMessage('mail:send')).toContain("Plugin 'mail'")
  })
})
