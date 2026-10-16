import { Badge, Button, Inline, Stack } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Ready to merge',
  caption: 'A reviewed pull request, its merge, and the archive that follows.',
  terminal: { columns: 60, rows: 3 },
  width: 480,
}

export default function Ship() {
  return (
    <Stack gap="row">
      <Inline gap="inline">
        <Badge tone="ok">checks passed</Badge>
        <Badge tone="accent">approved</Badge>
      </Inline>
      <Inline gap="inline">
        <Button variant="solid" tone="accent" label="Squash and merge" />
        <Button variant="outline" label="Archive task" />
      </Inline>
    </Stack>
  )
}
