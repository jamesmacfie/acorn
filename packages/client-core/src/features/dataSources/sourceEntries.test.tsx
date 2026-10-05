import { describe, expect, it } from 'vitest'
import { accountGroup } from './sourceEntries'

// A .tsx file so it runs in the hosts project: `pluginLabel` comes through the feature's kit seam,
// which also exports Solid components.

describe('accountGroup', () => {
  it('names the plugin once, even when the account name already starts with it', () => {
    expect(accountGroup('github', { name: 'Work', label: 'GitHub' })).toBe('github · Work')
    expect(accountGroup('linear', { name: 'Linear · Runn', label: 'Linear' })).toBe('Linear · Runn')
    expect(accountGroup('rollbar', { label: 'Rollbar' })).toBe('Rollbar')
  })
})
