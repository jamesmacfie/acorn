import { Table, TableCell, TableHead, TableRow } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Table',
  caption: 'A table with a header row and three rows.',
  terminal: { columns: 50, rows: 7 },
  width: 480,
}

export default function TableSpecimen() {
  return (
    <Table>
      <TableRow head>
        <TableHead>Check</TableHead>
        <TableHead>Status</TableHead>
        <TableHead priority="low">Time</TableHead>
      </TableRow>
      <TableRow>
        <TableCell>lint</TableCell>
        <TableCell>passed</TableCell>
        <TableCell>48s</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>unit tests</TableCell>
        <TableCell>passed</TableCell>
        <TableCell>3m 12s</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>e2e</TableCell>
        <TableCell>running</TableCell>
        <TableCell>1m 05s</TableCell>
      </TableRow>
    </Table>
  )
}
