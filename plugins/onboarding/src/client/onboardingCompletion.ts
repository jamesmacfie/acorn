import type { QueryClient } from '@tanstack/solid-query'
import { PrefKeys, savePref } from '@acorn/plugin-api/client'

export async function saveOnboardingCompletion(queryClient: QueryClient, onSaved: () => void): Promise<boolean> {
  const saved = await savePref(queryClient, PrefKeys.onboarded, '1')
  if (saved) onSaved()
  return saved
}
