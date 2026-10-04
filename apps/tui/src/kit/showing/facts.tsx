/** @jsxImportSource @acorn/tui/jsx */
import { For, type JSX } from 'solid-js'
import type { Size, Tone } from '@acorn/client-core/kit/tokens'
import { Line, pad, slot } from '../cells'

/** Two columns, labels dim; `grouping="rows"` is one pair per line, which in cells is what both
 *  groupings are. */
export function Facts(props: {
  items: readonly { label: string; value: JSX.Element; mono?: boolean; wide?: boolean }[]
  size?: 'sm' | 'md'
  grouping?: 'tiles' | 'rows'
}) {
  const width = () => Math.max(0, ...props.items.map((item) => item.label.length))
  return (
    <box flexDirection="column">
      <For each={props.items}>
        {(item) => (
          <box flexDirection="row" gap={1}>
            <Line role="muted">{pad(item.label, width())}</Line>
            {slot(item.value)}
          </box>
        )}
      </For>
    </box>
  )
}

export function DescriptionList(props: { layout?: 'columns' | 'facts'; size?: 'sm' | 'md'; children: JSX.Element }) {
  return <box flexDirection="column">{props.children}</box>
}
DescriptionList.Item = (props: { label: JSX.Element; mono?: boolean; children: JSX.Element }) => (
  <box flexDirection="row" gap={1}>
    <Line role="muted">{props.label}</Line>
    {slot(props.children)}
  </box>
)

/** `████░░░░ 62%`. Eight cells, because a meter that spends a whole row on a ratio is a chart.
 *
 *  `mark` takes the cell it falls in rather than a row of its own: a second line under every meter
 *  would double the height of docker's stream of them, and the bar is only eight cells wide, so the
 *  mark is never more than a cell away from where the pixels would put it. */
export function Meter(props: {
  value: number
  tone?: Extract<Tone, 'accent' | 'ok' | 'warn' | 'danger'> | 'auto'
  label: string
  size?: Extract<Size, 'sm' | 'md'>
  mark?: number
}) {
  const CELLS = 8
  const ratio = () => Math.min(1, Math.max(0, props.value))
  const tone = () => {
    if (props.tone !== 'auto') return props.tone ?? 'accent'
    return ratio() >= 0.9 ? 'danger' : ratio() >= 0.75 ? 'warn' : 'accent'
  }
  const filled = () => Math.round(ratio() * CELLS)
  const bar = () => {
    const cells = '█'.repeat(filled()) + '░'.repeat(CELLS - filled())
    if (props.mark == null) return cells
    const at = Math.min(CELLS - 1, Math.floor(Math.min(1, Math.max(0, props.mark)) * CELLS))
    return cells.slice(0, at) + '▲' + cells.slice(at + 1)
  }
  return (
    <box flexDirection="row" gap={1}>
      <Line tone={tone()}>{bar()}</Line>
      <Line role="muted">{`${Math.round(ratio() * 100)}%`}</Line>
    </box>
  )
}
