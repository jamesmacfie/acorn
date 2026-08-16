import { cellText, formatCell } from '../format'
import { aggregateRows } from '../shaping'
import type { PanelViewProps } from './props'

// The stat view: one number over the SHAPED rows. A count by default, because "how many of these are
// there" is the question a filter has already been written to answer.
//
// The unit comes from the aggregated field, not from the view — so a panel that sums a field
// declared in MB says MB, and says it again if the panel later becomes a table.

const AGGREGATE_LABELS: Record<string, string> = { sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest' }

export default function StatView(props: PanelViewProps) {
  const aggregate = () => props.view.aggregate ?? 'count'
  const field = () => props.schema.fields.find((candidate) => candidate.id === props.view.field)
  const value = () => aggregateRows(props.rows, props.schema, props.view)

  const text = () => {
    const answer = value()
    // An em dash, not 0: "nothing to aggregate" and "the total is zero" are different, and only one
    // of them is a fact about the data (node/FleetHome.tsx makes the same distinction).
    if (answer === null) return '—'
    const rounded = Number.isInteger(answer) ? answer : Math.round(answer * 10) / 10
    const unitField = field()
    return aggregate() === 'count' || !unitField ? String(rounded) : cellText(formatCell(unitField, rounded))
  }

  const label = () => {
    if (aggregate() === 'count') return props.rows.length === 1 ? 'row' : 'rows'
    return `${AGGREGATE_LABELS[aggregate()] ?? aggregate()} · ${field()?.name ?? props.view.field ?? ''}`
  }

  return (
    <div class="dash-stat">
      <span class="dash-stat-value">{text()}</span>
      <span class="dash-stat-label">{label()}</span>
    </div>
  )
}
