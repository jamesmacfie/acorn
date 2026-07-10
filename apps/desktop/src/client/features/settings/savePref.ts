import type { QueryClient } from '@tanstack/solid-query'
import { prefsKey } from '../../../shared/api'
import { setPref } from '../../mutations'
import { pushBackgroundError } from '../notifications/notifications'

// Write a pref AND update the shared ['prefs'] cache so consumers (e.g. TerminalPanel, the theme
// effect in App) see it without waiting for a refetch. Shared by the Settings tab components.
export async function savePref(qc: QueryClient, key: string, value: string): Promise<void> {
  try {
    await setPref(key, value)
    qc.setQueryData<Record<string, string>>(prefsKey, (old) => ({ ...(old ?? {}), [key]: value }))
  } catch (error) {
    pushBackgroundError('', `Could not save ${key}`, error instanceof Error ? error.message : String(error))
  }
}
