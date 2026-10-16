import { Button, Pane, SectionHeader, Stack, Text, Toolbar, ToolbarSpacer } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Pane',
  caption: 'A pane with a header, a body that takes the room left, and a toolbar along the bottom.',
  terminal: { columns: 60, rows: 6 },
  width: 480,
}

export default function PaneSpecimen() {
  return (
    <Pane>
      <SectionHeader level="pane" count={3}>
        Deploys
      </SectionHeader>
      <Stack grow gap="row">
        <Text>staging · 12 minutes ago</Text>
        <Text>production · yesterday</Text>
        <Text emphasis="muted">preview · failed</Text>
      </Stack>
      <Toolbar variant="actions">
        <ToolbarSpacer />
        <Button label="Deploy" variant="solid" tone="accent" />
      </Toolbar>
    </Pane>
  )
}
