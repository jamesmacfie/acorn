import { useQueryClient } from '@tanstack/solid-query'
import { Button } from '@acorn/client-core/kit/components/primitives.tsx'
import { SettingRow, SettingsSection } from '@acorn/client-core/kit/components/layout'
import { clearCache } from './clearCache'

// Settings → Clear cache: the top bar menu's item, as a page someone can find by looking in settings.
export default function ClearCacheSettings() {
  const queryClient = useQueryClient()
  return (
    <SettingsSection id="cache" label="Cache">
      <SettingRow
        label="Cached answers"
        description="Forget what this window remembers from every node and reload. Nothing on a node changes, and the window asks each node again."
      >
        <Button size="sm" onPress={() => void clearCache(queryClient)}>Clear cache and reload</Button>
      </SettingRow>
    </SettingsSection>
  )
}
