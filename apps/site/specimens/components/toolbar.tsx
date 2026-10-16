import { Button, Text, Toolbar, ToolbarSpacer } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Toolbar and ToolbarSpacer',
  caption: 'A toolbar with a count at the start and its actions pushed to the end.',
  terminal: { columns: 60, rows: 2 },
  width: 480,
}

export default function ToolbarSpecimen() {
  return (
    <Toolbar ariaLabel="Deploys">
      <Text emphasis="muted">3 deploys</Text>
      <ToolbarSpacer />
      <Button label="Refresh" variant="ghost" />
      <Button label="Deploy" variant="solid" tone="accent" />
    </Toolbar>
  )
}
