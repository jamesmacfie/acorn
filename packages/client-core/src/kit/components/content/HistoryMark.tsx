import { HISTORY_VISIBLE_LANES, type HistorySlot } from '../../lib/layout/historyLayout'

/** One compact row of the history drawing. Text outside this aria-hidden mark names the parents. */
export function HistoryMark(props: { slot: HistorySlot }) {
  const shown = () => Math.min(props.slot.lanes, HISTORY_VISIBLE_LANES)
  const hidden = () => Math.max(0, props.slot.lanes - HISTORY_VISIBLE_LANES)
  const width = () => shown() * 12 + (hidden() ? 30 : 0)
  const x = (lane: number) => lane * 12 + 6
  return <span class="ui-history-mark" aria-hidden="true" style={{ width: `${width()}px` }}>
    <svg width="100%" height="100%" viewBox={`0 0 ${width()} 100`} preserveAspectRatio="none">
      {props.slot.edges.filter((edge) => edge.from < HISTORY_VISIBLE_LANES && edge.to < HISTORY_VISIBLE_LANES)
        .map((edge) => <line x1={x(edge.from)} y1={edge.start === 'top' ? 0 : 50} x2={x(edge.to)}
          y2={edge.end === 'center' ? 50 : 100} stroke="currentColor" stroke-dasharray={edge.continuation ? '3 3' : undefined}
          vector-effect="non-scaling-stroke" />)}
      {props.slot.lane < HISTORY_VISIBLE_LANES && <circle cx={x(props.slot.lane)} cy="50" r="4" fill="currentColor" />}
      {hidden() > 0 && <text x={HISTORY_VISIBLE_LANES * 12 + 2} y="53" fill="currentColor" font-size="10">+{hidden()}</text>}
    </svg>
  </span>
}
