import type { HistorySlot } from '../../lib/layout/historyLayout'

/** One compact row of the history drawing. Text outside this aria-hidden mark names the parents. */
export function HistoryMark(props: { slot: HistorySlot }) {
  const width = () => Math.min(8, Math.max(props.slot.lane + 1, ...props.slot.lanes.map((lane) => lane + 1), ...props.slot.parentLanes.map((lane) => lane + 1))) * 12
  const x = (lane: number) => Math.min(lane, 7) * 12 + 6
  return <svg aria-hidden="true" width={width()} height="28" viewBox={`0 0 ${width()} 28`} style={{ 'flex-shrink': '0' }}>
    {props.slot.lanes.map((lane) => <line x1={x(lane)} y1="0" x2={x(lane)} y2="28" stroke="currentColor" opacity="0.35" />)}
    {props.slot.parentLanes.map((lane) => <line x1={x(props.slot.lane)} y1="14" x2={x(lane)} y2="28" stroke="currentColor" stroke-dasharray={props.slot.continuation ? '2 2' : undefined} />)}
    <circle cx={x(props.slot.lane)} cy="14" r="4" fill="currentColor" />
  </svg>
}
