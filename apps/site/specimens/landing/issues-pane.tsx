import { Table, TableCell, TableHead, TableRow } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Issues',
  caption: "One plugin's pane: the same tree, drawn by the desktop app and by the terminal client.",
  terminal: { columns: 60, rows: 4 },
  width: 560,
}

const issues = [
  ['FW-12', 'Webhooks give up', 'In progress'],
  ['FW-14', 'VAT on EU invoices', 'In review'],
  ['FW-15', 'Slow overdue query', 'Todo'],
]

export default function IssuesPane() {
  return (
    <Table>
      <TableRow head>
        <TableHead>Issue</TableHead>
        <TableHead>Title</TableHead>
        <TableHead>State</TableHead>
      </TableRow>
      {issues.map(([id, title, state]) => (
        <TableRow>
          <TableCell>{id}</TableCell>
          <TableCell>{title}</TableCell>
          <TableCell>{state}</TableCell>
        </TableRow>
      ))}
    </Table>
  )
}
