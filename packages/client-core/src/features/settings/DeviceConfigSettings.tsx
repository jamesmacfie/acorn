import { createResource, Show } from 'solid-js'
import { Button } from '../../kit/components/primitives'
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
      label="Device config file"
      description="Edit this file to change appearance, shortcuts and replacement surfaces on this device."
    >
      <Show when={configPath()} fallback={<p class="muted">This app keeps no config file on this device.</p>}>{(path) =>
        <SettingRow label="Location" layout="stacked">
          <code>{path()}</code>
          <Show when={desktopExtras()}>{(desktop) =>
            <Button size="sm" onPress={() => void desktop().openConfigFile()}>Open config file</Button>
          }</Show>
        </SettingRow>
      }</Show>
    </SettingsSection>
  )
}
