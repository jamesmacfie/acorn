import { Picker } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Picker',
  caption: 'A closed picker. Pressing it opens a list the reader filters by typing.',
  terminal: { columns: 40, rows: 1 },
  width: 320,
}

export default function PickerSpecimen() {
  return (
    <Picker
      label="Assignee"
      placeholder="Search people"
      emptyText="No one matches"
      items={[
        { id: 'alex', label: 'Alex', note: 'alex@acme.dev' },
        { id: 'sam', label: 'Sam', note: 'sam@acme.dev', active: true },
      ]}
      onPick={() => {}}
    />
  )
}
