import type { QueryClient } from '@tanstack/solid-query'
import { PrefKeys } from '@acorn/client-core/persistence/prefKeys.ts'
import { savePref } from '@acorn/client-core/settings/savePref.ts'

export async function saveOnboardingCompletion(queryClient: QueryClient, onSaved: () => void): Promise<boolean> {
  const saved = await savePref(queryClient, PrefKeys.onboarded, '1')
  if (saved) onSaved()
  return saved
}
