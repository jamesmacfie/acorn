import { describe, expect, it } from 'vitest'
import { buildSettingsIndex, searchSettings, type SettingsSearchObject } from './settingsSearch'

// A plugin is listed under its name, and its id still finds it.
const plugin = (name: string, id: string): SettingsSearchObject => ({
  name, keywords: [id], page: 'plugins', pageLabel: 'Installed', group: 'Plugins', scope: 'node',
})

describe('settings search', () => {
  it('finds a thing by a keyword it carries and shows its name, with the keyword as the match', () => {
    const index = buildSettingsIndex([], [plugin('API requests', 'http'), plugin('Sentry export', 'sentry-telemetry')])
    expect(searchSettings(index, 'http')).toEqual([
      expect.objectContaining({ page: 'plugins', pageLabel: 'Installed', sectionLabel: 'API requests', matched: 'http' }),
    ])
    expect(searchSettings(index, 'telemetry').map((result) => result.sectionLabel)).toEqual(['Sentry export'])
  })

  it('lists a thing once when its name and its keyword both match, under the better match', () => {
    const index = buildSettingsIndex([], [plugin('Docker', 'docker')])
    const results = searchSettings(index, 'dock')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ sectionLabel: 'Docker', tier: 1 })
    expect(results[0]?.matched).toBeUndefined()
  })
})
