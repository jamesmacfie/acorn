import { ConfirmButton, Inline } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'ConfirmButton',
  caption: 'A delete button. The first press arms it, and the second sends onConfirm.',
  terminal: { columns: 40, rows: 1 },
  width: 320,
}

export default function ConfirmButtonSpecimen() {
  return (
    <Inline gap="inline">
      <ConfirmButton label="Delete branch" confirmLabel="Delete?" tone="danger" onConfirm={() => {}} />
    </Inline>
  )
}
