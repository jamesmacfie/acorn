import { SettingRow, SettingsSection, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'SettingsSection with rows',
  caption: 'A settings section: a label, a description, and a row per setting.',
  terminal: { columns: 60, rows: 7 },
  width: 560,
}

export default function SettingsSectionSpecimen() {
  return (
    <SettingsSection id="dev-server" label="Dev server" description="How acorn starts this project.">
      <SettingRow label="Command">
        <Text>pnpm dev</Text>
      </SettingRow>
      <SettingRow label="Port" help="Used for the preview pane.">
        <Text>4000</Text>
      </SettingRow>
    </SettingsSection>
  )
}
