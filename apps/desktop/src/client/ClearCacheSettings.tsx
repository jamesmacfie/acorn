import { useQueryClient } from '@tanstack/solid-query'
import { Button } from '@acorn/client-core/kit/components/primitives.tsx'
import { SettingRow, SettingsSection } from '@acorn/client-core/kit/components/layout'
import { clearCache } from './clearCache'

// Settings → Clear cache: the top bar menu's item, as a page someone can find by looking in settings.
export default function ClearCacheSettings() {
  const queryClient = useQueryClient()
  return (
    <SettingsSection id="cache" label="This window">
      <SettingRow
        label="Saved copies of what acorn loaded"
        description="Your tasks and settings aren't affected."
        help="acorn keeps copies of what it loaded so the window opens fast. Clearing them makes it load everything again."
      >
        <Button onPress={() => void clearCache(queryClient)}>Clear cache and reload</Button>
      </SettingRow>
    </SettingsSection>
  )
}
