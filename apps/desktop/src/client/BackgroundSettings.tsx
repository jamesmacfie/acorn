import { createSignal, onCleanup } from 'solid-js'
import type { DeviceConfig } from '@acorn/protocol/deviceConfig.ts'
import { deviceConfigBridge } from '@acorn/client-core/infra/platform'
import { Checkbox } from '@acorn/client-core/kit/components/primitives.tsx'
import { Text } from '@acorn/client-core/kit/components/content'
import { SettingRow, SettingsSection } from '@acorn/client-core/kit/components/layout'

// Tray mode's two switches. Both live in acorn.json, and the bridge passes them to the shell, which
// owns the tray and the login item (docs/shell/process.md § Tray mode).
export default function BackgroundSettings() {
  const bridge = deviceConfigBridge()
  const [config, setConfig] = createSignal<DeviceConfig>({})
  const [error, setError] = createSignal('')
  void bridge?.read().then((state) => setConfig(state.config))
  if (bridge) onCleanup(bridge.onChange((state) => setConfig(state.config)))

  // Resolves false on a failed write, so the switch goes back to what the file says.
  const save = async (patch: Partial<DeviceConfig>): Promise<boolean> => {
    setError('')
    try {
      setConfig((await bridge!.write(patch)).config)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }

  const keep = () => config().keepNodeRunning === true

  return (
    <SettingsSection
      id="background"
      label="When the window closes"
      description="Keep this computer's Node working for clients on other machines, with an icon in the menu bar or system tray."
    >
      <SettingRow label="Keep the Node running when the window closes" error={error() || undefined}>
        <Checkbox
          switch
          ariaLabel="Keep the Node running when the window closes"
          disabled={!bridge}
          checked={keep()}
          onChange={(on) => save({ keepNodeRunning: on })}
        />
      </SettingRow>
      <SettingRow label="Open acorn at login" description="Opens with no window, in the tray.">
        <Checkbox
          switch
          ariaLabel="Open acorn at login"
          disabled={!keep()}
          checked={keep() && config().openAtLogin === true}
          onChange={(on) => save({ openAtLogin: on })}
        />
      </SettingRow>
      <Text emphasis="muted" wrap>
        While the window is closed, this computer shows no acorn notifications. Clients on other machines still show
        them.
      </Text>
    </SettingsSection>
  )
}
