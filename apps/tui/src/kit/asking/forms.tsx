/** @jsxImportSource @acorn/tui/jsx */
import { Index, Show, type JSX } from 'solid-js'
import { Line, slot } from '../cells'
import { Checkbox } from './choices'
import { Input } from './fields'

/** A two-column table with editable cells, each cell a stop. `<Index>`, not `<For>`: `<For>` keys by
 *  object identity, so replacing a row on every keystroke tears down its field and drops the cursor.
 *  The gotcha is the same on both hosts. */
export function KeyValueEditor(props: {
  rows: readonly { enabled?: boolean; key: string; value: string }[]
  onChange: (rows: { enabled?: boolean; key: string; value: string }[]) => void
  columns?: readonly { id: string; header: string; render: (row: { enabled?: boolean; key: string; value: string }, update: (patch: Partial<{ enabled: boolean; key: string; value: string }>) => void, index: number) => JSX.Element }[]
  rowHint?: (row: { enabled?: boolean; key: string; value: string }) => string | undefined
  enableColumn?: boolean
  keyPlaceholder?: string
  valuePlaceholder?: string
  ariaLabel: string
}) {
  const blank = () => ({ key: '', value: '', enabled: true })
  const padded = () => [...props.rows, blank()]
  const write = (index: number, patch: Partial<{ enabled: boolean; key: string; value: string }>) => {
    const next = [...props.rows]
    if (index === props.rows.length) next.push({ ...blank(), ...patch })
    else next[index] = { ...next[index], ...patch }
    props.onChange(next.filter((row, at) => row.key || row.value || at === index))
  }
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <Line role="strong">{props.keyPlaceholder ?? 'Name'}</Line>
        <Line role="strong">{props.valuePlaceholder ?? 'Value'}</Line>
      </box>
      <Index each={padded()}>
        {(row, index) => (
          <box flexDirection="row" gap={1}>
            <Show when={props.enableColumn !== false}>
              <Checkbox checked={row().enabled} onChange={(checked) => write(index, { enabled: checked })} />
            </Show>
            <Input value={row().key} placeholder={props.keyPlaceholder ?? 'Name'} onInput={(value) => write(index, { key: value })} />
            <Input value={row().value} placeholder={props.valuePlaceholder ?? 'Value'} onInput={(value) => write(index, { value })} />
          </box>
        )}
      </Index>
    </box>
  )
}

/** `/ query  3/12` on one line. */
export function FindBar(props: {
  query: string
  onQuery: (query: string) => void
  count?: { current: number; total: number }
  onNext: () => void
  onPrev: () => void
  onClose?: () => void
  toggles?: JSX.Element
  status?: JSX.Element
  placeholder?: string
  ref?: unknown
}) {
  return (
    <box flexDirection="row" gap={1}>
      <Line tone="accent">/</Line>
      <Input kind="filter" placeholder={props.placeholder ?? 'Find…'} value={props.query} onInput={props.onQuery} />
      <Show when={props.count}>
        {(count) => (
          <Line role="muted">{count().total ? `${count().current}/${count().total}` : 'no matches'}</Line>
        )}
      </Show>
      {slot(props.status)}
      {slot(props.toggles)}
    </box>
  )
}

/** The label above its child. */
export function Field(props: {
  label?: string
  hint?: string
  error?: string
  layout?: 'stack' | 'row' | 'split'
  group?: boolean
  children: JSX.Element
}) {
  return (
    <box flexDirection={props.layout === 'row' ? 'row' : 'column'} gap={props.layout === 'row' ? 1 : 0}>
      <Show when={props.label}><Line role="muted">{props.label!}</Line></Show>
      {props.children}
      <Show when={props.hint}><Line role="muted">{props.hint!}</Line></Show>
      <Show when={props.error}><Line tone="danger">{props.error!}</Line></Show>
    </box>
  )
}
