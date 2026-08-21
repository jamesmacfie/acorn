import { For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../queries'
import { savePref } from './savePref'
import { resolveTheme, THEMES } from './themes'
import { STYLES } from './uiStyles'
import { Checkbox, Field, Select } from '../ui/primitives'
import { PrefKeys } from '../persistence/prefKeys'

// Settings → Appearance. Two orthogonal axes (docs/ui-design.md § Token axes): style owns shape,
// typography, spacing and density; theme owns colour. They compose freely, because the two token sets
// are disjoint, which styles/tokenAxes.test.ts enforces.
//
// Theme additionally has a follow-the-OS mode with one pick per mode; style has no OS signal, so it
// is a single value.
//
// Also the first call site converted to the <Field>/<Select> primitives, which is why it reads
// noticeably shorter than the settings pages that still hand-roll label + select markup.
export default function AppearanceSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const style = () => prefs.data?.[PrefKeys.style] ?? 'terminal'
  // Default to following the OS until the user has explicitly picked a theme.
  const followSystem = () => (prefs.data?.[PrefKeys.themeFollowSystem] ?? (prefs.data?.[PrefKeys.theme] ? 'false' : 'true')) === 'true'
  // Through `resolveTheme` (see its own doc comment), so the picker shows the theme that is on screen
  // rather than a stored id the shell has already fallen back on.
  const theme = () => resolveTheme(prefs.data?.[PrefKeys.theme], 'light')
  const lightTheme = () => resolveTheme(prefs.data?.[PrefKeys.themeLight], 'light')
  const darkTheme = () => resolveTheme(prefs.data?.[PrefKeys.themeDark], 'dark')

  const themeOptions = () => <For each={THEMES()}>{([value, label]) => <option value={value}>{label}</option>}</For>

  return (
    <>
      <Field label="Style" hint="Shape, typography and density. Colour is the theme below.">
        <Select value={style()} onChange={(e) => void savePref(qc, PrefKeys.style, e.currentTarget.value)}>
          <For each={STYLES()}>{([value, label]) => <option value={value}>{label}</option>}</For>
        </Select>
      </Field>

      <Checkbox
        class="settings-field settings-field-row"
        label="Follow system light/dark setting"
        checked={followSystem()}
        onChange={(e) => void savePref(qc, PrefKeys.themeFollowSystem, e.currentTarget.checked ? 'true' : 'false')}
      />
      <Show
        when={followSystem()}
        fallback={
          <Field label="Theme">
            <Select value={theme()} onChange={(e) => void savePref(qc, PrefKeys.theme, e.currentTarget.value)}>
              {themeOptions()}
            </Select>
          </Field>
        }
      >
        <Field label="Light theme">
          <Select value={lightTheme()} onChange={(e) => void savePref(qc, PrefKeys.themeLight, e.currentTarget.value)}>
            {themeOptions()}
          </Select>
        </Field>
        <Field label="Dark theme">
          <Select value={darkTheme()} onChange={(e) => void savePref(qc, PrefKeys.themeDark, e.currentTarget.value)}>
            {themeOptions()}
          </Select>
        </Field>
      </Show>
    </>
  )
}
