import { SegmentedControl } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'SegmentedControl',
  caption: 'Three views of a diff, with Split chosen.',
  terminal: { columns: 40, rows: 1 },
  width: 320,
}

export default function SegmentedControlSpecimen() {
  return (
    <SegmentedControl
      ariaLabel="Diff view"
      value="split"
      options={[
        { value: 'unified', label: 'Unified' },
        { value: 'split', label: 'Split' },
        { value: 'files', label: 'Files' },
      ]}
      onChange={() => {}}
    />
  )
}
