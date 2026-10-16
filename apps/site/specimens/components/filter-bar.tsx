import { FilterBar, IconButton, Input } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'FilterBar',
  caption: 'A filter input with an options button, as a sidebar draws its search.',
  terminal: { columns: 50, rows: 1 },
  width: 360,
}

export default function FilterBarSpecimen() {
  return (
    <FilterBar ariaLabel="Search issues">
      <Input kind="filter" label="Search issues" placeholder="Search issues" value="redirect" />
      <IconButton icon="list-filter" label="Filter options" />
    </FilterBar>
  )
}
