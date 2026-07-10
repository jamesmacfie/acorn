import type { QueryClient } from '@tanstack/solid-query'
import { PrefKeys } from '../../persistence/prefKeys'
import { savePref } from '../settings/savePref'

export async function saveOnboardingCompletion(queryClient: QueryClient, onSaved: () => void): Promise<boolean> {
  const saved = await savePref(queryClient, PrefKeys.onboarded, '1')
  if (saved) onSaved()
  return saved
}
