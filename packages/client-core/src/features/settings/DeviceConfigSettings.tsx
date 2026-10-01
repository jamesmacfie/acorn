import { createResource, Show } from 'solid-js'
import { Button, EmptyState } from '../../kit/components/primitives'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { desktopExtras, deviceConfigBridge } from '../../infra/platform'

// Settings → Device config file: where this device keeps the choices Appearance, Keyboard shortcuts
// and the replacement-surface picker write, for someone who would rather edit the file by hand. A host
// with no such file draws nothing but the sentence saying so.
export default function DeviceConfigSettings() {
  const [configPath] = createResource(async () => deviceConfigBridge()?.location() ?? null)

  return (
    <SettingsSection
      id="file"
      label="Location"
      description="Your appearance, shortcut, and layout choices for this computer are saved here. You can edit the file by hand."
    >
      <Show
        when={configPath()}
        fallback={<EmptyState align="start" size="sm" busy={configPath.loading}>{configPath.loading ? undefined : 'This app keeps no config file on this device.'}</EmptyState>}
      >
        {(path) => (
          // One row: the path is what the row describes, and opening it is the one thing to do.
          <SettingRow label="File" description={path()}>
            <Show when={desktopExtras()}>{(desktop) =>
              <Button onPress={() => void desktop().openConfigFile()}>Open file</Button>
            }</Show>
          </SettingRow>
        )}
      </Show>
    </SettingsSection>
  )
}
