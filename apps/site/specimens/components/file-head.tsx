import { FileHead } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'FileHead',
  caption: "A changed file's head: its status, its path, and the lines added and removed.",
  terminal: { columns: 60, rows: 1 },
  width: 480,
}

export default function FileHeadSpecimen() {
  return <FileHead file={{ status: 'modified', path: 'src/login.ts', additions: 2, deletions: 1 }} />
}
