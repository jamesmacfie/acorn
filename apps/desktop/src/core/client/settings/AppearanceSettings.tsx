import { For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../queries'
import { savePref } from './savePref'
import { THEMES } from './themes'
import { PrefKeys } from '../persistence/prefKeys'

// Settings → Appearance: follow-system toggle plus theme picker(s). When following the OS, the
// user picks one theme per OS mode (App.tsx swaps them live on the media query); otherwise a
// single fixed theme.
export default function AppearanceSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  // Default to following the OS until the user has explicitly picked a theme.
  const followSystem = () => (prefs.data?.[PrefKeys.themeFollowSystem] ?? (prefs.data?.[PrefKeys.theme] ? 'false' : 'true')) === 'true'
  const theme = () => prefs.data?.[PrefKeys.theme] ?? 'light'
  const lightTheme = () => prefs.data?.[PrefKeys.themeLight] ?? 'light'
  const darkTheme = () => prefs.data?.[PrefKeys.themeDark] ?? 'dark'

  return (
    <>
      <label class="settings-field settings-field-row">
        <input
          type="checkbox"
          checked={followSystem()}
          onChange={(e) => void savePref(qc, PrefKeys.themeFollowSystem, e.currentTarget.checked ? 'true' : 'false')}
        />
        <span class="settings-label">Follow system light/dark setting</span>
      </label>
      <Show
        when={followSystem()}
        fallback={
          <label class="settings-field">
            <span class="settings-label">Theme</span>
            <select
              class="integration-key-input"
              value={theme()}
              onChange={(e) => void savePref(qc, PrefKeys.theme, e.currentTarget.value)}
            >
              <For each={THEMES}>{([value, label]) => <option value={value}>{label}</option>}</For>
            </select>
          </label>
        }
      >
        <label class="settings-field">
          <span class="settings-label">Light theme</span>
          <select
            class="integration-key-input"
            value={lightTheme()}
            onChange={(e) => void savePref(qc, PrefKeys.themeLight, e.currentTarget.value)}
          >
            <For each={THEMES}>{([value, label]) => <option value={value}>{label}</option>}</For>
          </select>
        </label>
        <label class="settings-field">
          <span class="settings-label">Dark theme</span>
          <select
            class="integration-key-input"
            value={darkTheme()}
            onChange={(e) => void savePref(qc, PrefKeys.themeDark, e.currentTarget.value)}
          >
            <For each={THEMES}>{([value, label]) => <option value={value}>{label}</option>}</For>
          </select>
        </label>
      </Show>
    </>
  )
}
