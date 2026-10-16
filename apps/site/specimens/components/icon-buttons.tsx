import { IconButton, Inline } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'IconButton',
  caption: 'Three icon buttons. Each label names the button, and the terminal draws the label.',
  terminal: { columns: 40, rows: 1 },
  width: 320,
}

export default function IconButtons() {
  return (
    <Inline gap="inline">
      <IconButton icon="refresh-cw" label="Refresh" />
      <IconButton icon="copy" label="Copy link" />
      <IconButton icon="trash-2" label="Delete" tone="danger" />
    </Inline>
  )
}
