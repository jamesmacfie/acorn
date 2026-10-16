import { EmptyState } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'EmptyState',
  caption: 'An empty list, with a title and a line saying what fills it.',
  terminal: { columns: 60, rows: 4 },
  width: 400,
}

export default function EmptyStateSpecimen() {
  return <EmptyState title="No deploys yet">Deploys for this project show here once one runs.</EmptyState>
}
