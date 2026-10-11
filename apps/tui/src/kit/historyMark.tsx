/** @jsxImportSource @acorn/tui/jsx */
import type { HistorySlot } from '@acorn/client-core/kit/components/content'
import { Text } from './showing'

export function HistoryMark(props: { slot: HistorySlot }) {
  return (
    <Text emphasis="muted">
      {props.slot.disconnected ? '○' : props.slot.continuation ? '●⋯' : '●'}
      {props.slot.lane > 0 ? ` ${props.slot.lane + 1}` : ''}
    </Text>
  )
}
