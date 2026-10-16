import { Button, Inline, Stack } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Button variants',
  caption: 'Solid, outline, ghost, and bare buttons, with a danger tone and a disabled one.',
  terminal: { columns: 60, rows: 4 },
  width: 480,
}

export default function Buttons() {
  return (
    <Stack gap="row">
      <Inline gap="inline">
        <Button variant="solid" tone="accent" label="Run checks" />
        <Button variant="outline" label="Open diff" />
        <Button variant="ghost" label="Skip" />
        <Button variant="bare" label="Details" />
      </Inline>
      <Inline gap="inline">
        <Button variant="outline" tone="danger" label="Delete branch" />
        <Button variant="outline" label="Merge" disabled />
      </Inline>
    </Stack>
  )
}
