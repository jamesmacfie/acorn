import { describe, expect, it } from 'vitest'
import type { Integration } from '../../../shared/api'
import { availableSources } from './sources'

const integration = (provider: Integration['provider'], connected = true): Integration => ({
  id: provider,
  provider,
  label: provider,
  connected,
})

describe('availableSources (docs/integrations.md — gated by integration rows)', () => {
  it('GitHub always; Linear/Rollbar iff connected', () => {
    expect(availableSources(undefined).map((s) => s.id)).toEqual(['github'])
    expect(availableSources([integration('linear')]).map((s) => s.id)).toEqual(['github', 'linear'])
    expect(availableSources([integration('rollbar')]).map((s) => s.id)).toEqual(['github', 'rollbar'])
    expect(availableSources([integration('linear'), integration('rollbar')]).map((s) => s.id)).toEqual(['github', 'linear', 'rollbar'])
    expect(availableSources([integration('rollbar', false)]).map((s) => s.id)).toEqual(['github'])
  })
})
