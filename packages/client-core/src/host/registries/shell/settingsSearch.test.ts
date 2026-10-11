import { describe, expect, it } from 'vitest'
import { CORE_SETTINGS_PAGES } from '../../../features/settings/corePages'
import { settingsCategoryLabel, settingsPageForMode } from '../../../features/settings/settingsPresentation'
import type { SettingsContribution } from './settings'
import { buildSettingsIndex, searchSettings, type SettingsSearchObject } from './settingsSearch'

// A plugin is listed under its name, and its id still finds it.
const plugin = (name: string, id: string): SettingsSearchObject => ({
  name,
  keywords: [id],
  page: 'plugins',
  pageLabel: 'Installed',
  group: 'Plugins',
  scope: 'node',
})

describe('settings search', () => {
  it.each(['off', 'on'] as const)('uses the %s mode for group labels and available terms', (mode) => {
    const ids = new Set(['workspaces', 'shortcuts', 'project.detail'])
    const pages = CORE_SETTINGS_PAGES.filter((page) => ids.has(page.id)).map((page) =>
      settingsPageForMode({ ...page, component: () => null } as SettingsContribution, mode),
    )
    const index = buildSettingsIndex(pages, [], (category) => settingsCategoryLabel(category, mode))
    expect(searchSettings(index, 'Overview')[0]?.group).toBe(mode === 'off' ? 'Projects' : 'Workspaces and projects')
    expect(searchSettings(index, 'new workspace').some((entry) => entry.page === 'workspaces')).toBe(mode === 'on')
    expect(searchSettings(index, 'Switch to the last project').some((entry) => entry.page === 'shortcuts')).toBe(
      mode === 'off',
    )
    expect(searchSettings(index, 'Switch to the last workspace').some((entry) => entry.page === 'shortcuts')).toBe(
      mode === 'on',
    )
    const detail = pages.find((page) => page.id === 'project.detail')!
    expect(detail.sections?.find((section) => section.id === 'general')?.rows?.includes('Workspace')).toBe(
      mode === 'on',
    )
  })
  it('finds a thing by a keyword it carries and shows its name, with the keyword as the match', () => {
    const index = buildSettingsIndex([], [plugin('API requests', 'http'), plugin('Sentry export', 'sentry-telemetry')])
    expect(searchSettings(index, 'http')).toEqual([
      expect.objectContaining({
        page: 'plugins',
        pageLabel: 'Installed',
        sectionLabel: 'API requests',
        matched: 'http',
      }),
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
