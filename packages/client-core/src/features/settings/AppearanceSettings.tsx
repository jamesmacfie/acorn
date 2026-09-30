import { Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../../infra/queries'
import {
  appearanceStyle,
  darkTheme,
  fixedTheme,
  lightTheme,
  saveAppearanceStyle,
  saveDarkTheme,
  saveFixedTheme,
  saveLightTheme,
  saveThemeFollowsSystem,
  styleChoices,
  themeChoices,
  themeFollowsSystem,
} from './appearancePrefs'
import { Checkbox, Select } from '../../kit/components/primitives'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { createSettingSave } from './settingSave'
import { DEFAULT_STYLE } from './uiStyles'

// Settings → Appearance. Two orthogonal axes (docs/ui-design.md § Token axes): style owns shape,
// typography, spacing and density; theme owns colour. They compose freely, because the two token sets
// are disjoint, which styles/tokenAxes.test.ts enforces.
//
// Theme additionally has a follow-the-OS mode with one pick per mode; style has no OS signal, so it
// is a single value.
//
// The reads, the writes and the two lists are `./appearancePrefs.ts`, not this file: the same five
// choices are also palette commands, and a setting with two persistence paths is a setting that starts
// disagreeing with itself. What is left here is the arrangement. The file those choices are written
// to has its own page under Advanced (./DeviceConfigSettings.tsx).
export default function AppearanceSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  // One save state per row, so a failure is said beside the control that failed. A select's own value
  // is its signal that the change landed, so these rows show the error and not Saved.
  const style = createSettingSave()
  const follow = createSettingSave()
  const theme = createSettingSave()
  const light = createSettingSave()
  const dark = createSettingSave()

  return (
    <>
      <SettingsSection id="style" label="Style" description="Shape, typography and density. Colour is the theme below.">
        <SettingRow
          label="Style"
          error={style.error()}
          onReset={appearanceStyle(prefs.data) === DEFAULT_STYLE ? undefined : () => void style.run(() => saveAppearanceStyle(qc, DEFAULT_STYLE))}
        >
          <Select
            label="Style"
            value={appearanceStyle(prefs.data)}
            options={styleChoices()}
            onChange={(value) => void style.run(() => saveAppearanceStyle(qc, value))}
          />
        </SettingRow>
      </SettingsSection>
      <SettingsSection id="theme" label="Theme">
        <SettingRow label="Follow system light and dark" error={follow.error()}>
          <Checkbox
            switch
            ariaLabel="Follow system light and dark"
            checked={themeFollowsSystem(prefs.data)}
            onChange={(checked) => follow.run(() => saveThemeFollowsSystem(qc, checked))}
          />
        </SettingRow>
        <Show
          when={themeFollowsSystem(prefs.data)}
          fallback={
            <SettingRow label="Theme" error={theme.error()}>
              <Select label="Theme" value={fixedTheme(prefs.data)} options={themeChoices()} onChange={(value) => void theme.run(() => saveFixedTheme(qc, value))} />
            </SettingRow>
          }
        >
          <SettingRow label="Light theme" error={light.error()}>
            <Select label="Light theme" value={lightTheme(prefs.data)} options={themeChoices()} onChange={(value) => void light.run(() => saveLightTheme(qc, value))} />
          </SettingRow>
          <SettingRow label="Dark theme" error={dark.error()}>
            <Select label="Dark theme" value={darkTheme(prefs.data)} options={themeChoices()} onChange={(value) => void dark.run(() => saveDarkTheme(qc, value))} />
          </SettingRow>
        </Show>
      </SettingsSection>
    </>
  )
}
