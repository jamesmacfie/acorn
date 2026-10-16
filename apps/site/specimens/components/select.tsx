import { Select } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Select',
  caption: 'A select showing its current choice.',
  terminal: { columns: 40, rows: 1 },
  width: 320,
}

export default function SelectSpecimen() {
  return (
    <Select
      label="Environment"
      value="staging"
      options={[
        { value: 'preview', label: 'Preview' },
        { value: 'staging', label: 'Staging' },
        { value: 'production', label: 'Production' },
      ]}
    />
  )
}
