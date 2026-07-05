import type { QueryClient } from '@tanstack/solid-query'
import { prefsKey } from '../../../shared/api'
import { setPref } from '../../mutations'

// Write a pref AND update the shared ['prefs'] cache so consumers (e.g. TerminalPanel, the theme
// effect in App) see it without waiting for a refetch. Shared by the Settings tab components.
export async function savePref(qc: QueryClient, key: string, value: string): Promise<void> {
  await setPref(key, value)
  qc.setQueryData<Record<string, string>>(prefsKey, (old) => ({ ...(old ?? {}), [key]: value }))
}
