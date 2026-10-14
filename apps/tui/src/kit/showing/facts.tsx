/** @jsxImportSource @acorn/tui/jsx */
import { createContext, createSignal, For, onCleanup, Show, useContext, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
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

/** Each item's label width, so every value starts in the same column. */
const LabelColumn = createContext<{ width: () => number; report: (key: object, width?: number) => void }>()

/** One pair per line, values in one column. A label can be a tree, a name and its refresh button,
 *  so `Facts`' padding of strings can't measure it: each item reports its label's drawn width and
 *  the list pads every label to the widest. */
export function DescriptionList(props: { layout?: 'columns' | 'facts'; size?: 'sm' | 'md'; children: JSX.Element }) {
  const [widths, setWidths] = createSignal(new Map<object, number>(), { equals: false })
  const report = (key: object, width?: number) => {
    if (widths().get(key) === width) return
    setWidths((map) => {
      if (width === undefined) map.delete(key)
      else map.set(key, width)
      return map
    })
  }
  return (
    <LabelColumn.Provider value={{ width: () => Math.max(0, ...widths().values()), report }}>
      <box flexDirection="column">{props.children}</box>
    </LabelColumn.Provider>
  )
}
DescriptionList.Item = (props: { label: JSX.Element; mono?: boolean; children: JSX.Element }) => {
  const column = useContext(LabelColumn)
  const key = {}
  let label: Renderable | undefined
  onCleanup(() => column?.report(key))
  // The inner box keeps its natural width, so the padding never feeds back into what it measures.
  return (
    <box flexDirection="row" gap={1}>
      <box flexDirection="row" flexShrink={0} minWidth={column?.width() ?? 0}>
        <box
          flexDirection="row"
          flexShrink={0}
          ref={(element: Renderable) => (label = element)}
          onSizeChange={() => column?.report(key, label?.width)}
        >
          <Line role="muted">{props.label}</Line>
        </box>
      </box>
      {slot(props.children)}
    </box>
  )
}

const PIE_QUARTERS = ['○', '◔', '◑', '◕', '●']

/** `████░░░░ 62%`. Eight cells, because a meter that spends a whole row on a ratio is a chart.
 *
 *  `mark` takes the cell it falls in rather than a row of its own: a second line under every meter
 *  would double the height of docker's stream of them, and the bar is only eight cells wide, so the
 *  mark is never more than a cell away from where the pixels would put it.
 *
 *  `shape="pie"` is one cell, the nearest quarter of a circle. It sits inline with text, as on the
 *  DOM, so it drops the percentage the bar prints beside itself. */
export function Meter(props: {
  value: number
  tone?: Extract<Tone, 'accent' | 'ok' | 'warn' | 'danger' | 'muted'> | 'auto'
  label: string
  size?: Extract<Size, 'sm' | 'md'>
  mark?: number
  shape?: 'bar' | 'pie'
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
    <Show when={props.shape !== 'pie'} fallback={<Line tone={tone()}>{PIE_QUARTERS[Math.round(ratio() * 4)]}</Line>}>
      <box flexDirection="row" gap={1}>
        <Line tone={tone()}>{bar()}</Line>
        <Line role="muted">{`${Math.round(ratio() * 100)}%`}</Line>
      </box>
    </Show>
  )
}
