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
import { Checkbox, Field, Select } from '../../kit/components/primitives'

// Settings → Appearance. Two orthogonal axes (docs/ui-design.md § Token axes): style owns shape,
// typography, spacing and density; theme owns colour. They compose freely, because the two token sets
// are disjoint, which styles/tokenAxes.test.ts enforces.
//
// Theme additionally has a follow-the-OS mode with one pick per mode; style has no OS signal, so it
// is a single value.
//
// The reads, the writes and the two lists are `./appearancePrefs.ts`, not this file: the same five
// choices are also palette commands, and a setting with two persistence paths is a setting that starts
// disagreeing with itself. What is left here is the arrangement.
export default function AppearanceSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))

  return (
    <>
      <Field label="Style" hint="Shape, typography and density. Colour is the theme below.">
        <Select
          value={appearanceStyle(prefs.data)}
          options={styleChoices()}
          onChange={(value) => void saveAppearanceStyle(qc, value)}
        />
      </Field>

      <Checkbox
        label="Follow system light/dark setting"
        checked={themeFollowsSystem(prefs.data)}
        onChange={(checked) => void saveThemeFollowsSystem(qc, checked)}
      />
      <Show
        when={themeFollowsSystem(prefs.data)}
        fallback={
          <Field label="Theme">
            <Select value={fixedTheme(prefs.data)} options={themeChoices()} onChange={(value) => void saveFixedTheme(qc, value)} />
          </Field>
        }
      >
        <Field label="Light theme">
          <Select value={lightTheme(prefs.data)} options={themeChoices()} onChange={(value) => void saveLightTheme(qc, value)} />
        </Field>
        <Field label="Dark theme">
          <Select value={darkTheme(prefs.data)} options={themeChoices()} onChange={(value) => void saveDarkTheme(qc, value)} />
        </Field>
      </Show>
    </>
  )
}
