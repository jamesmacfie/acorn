import { createMemo, Index, Show, type JSX } from 'solid-js'
import { cx } from './cx'
import Icon from './Icon'
import { Button, Checkbox, Input } from './primitives'

export type KVRow = { enabled?: boolean; key: string; value: string }

// The editable name/value grid, lifted from the http plugin's — which was the correct
// implementation, including the two things that are easy to get wrong:
//
//   1. `<Index>`, not `<For>`. `<For>` keys rows by object reference, so replacing a row on every
//      keystroke tears down its input and drops focus. `<Index>` keys by position. This is a
//      recorded repo gotcha and the port must not lose it.
//   2. The trailing blank row that materialises as you type, so there is always somewhere to type,
//      and rows the user empties out are dropped — except the one being typed in.
//
// Controlled and dumb: the blank-row invariant lives inside, everything else is the caller's data.
export function KeyValueEditor(props: {
  rows: readonly KVRow[]
  onChange: (rows: KVRow[]) => void
  /** Extra columns between value and the remove button — http's variable-kind select. */
  columns?: readonly {
    id: string
    header: string
    render: (row: KVRow, update: (patch: Partial<KVRow>) => void, index: number) => JSX.Element
  }[]
  /** A note that spans the row beneath it. */
  rowHint?: (row: KVRow) => string | undefined
  enableColumn?: boolean
  keyPlaceholder?: string
  valuePlaceholder?: string
  ariaLabel: string
  class?: string
}) {
  const blank = (): KVRow => ({ key: '', value: '', enabled: true })
  const padded = createMemo(() => [...props.rows, blank()])
  const withEnable = () => props.enableColumn !== false

  const write = (index: number, patch: Partial<KVRow>) => {
    const next = [...props.rows]
    if (index === props.rows.length) next.push({ ...blank(), ...patch })
    else next[index] = { ...next[index], ...patch }
    props.onChange(next.filter((row, i) => row.key || row.value || i === index))
  }

  return (
    <div
      class={cx('ui-kvgrid', props.class)}
      role="table"
      aria-label={props.ariaLabel}
      style={{ '--kv-extra-cols': String(props.columns?.length ?? 0) }}
    >
      <div class="ui-kvgrid-head" role="row">
        <Show when={withEnable()}><span /></Show>
        <span>{props.keyPlaceholder ?? 'Name'}</span>
        <span>{props.valuePlaceholder ?? 'Value'}</span>
        <Index each={props.columns ?? []}>{(column) => <span>{column().header}</span>}</Index>
        <span />
      </div>
      <Index each={padded()}>
        {(row, index) => (
          <>
            <div class="ui-kvgrid-row" role="row" data-blank={index === props.rows.length ? '' : undefined}>
              <Show when={withEnable()}>
                <Checkbox
                  checked={row().enabled}
                  disabled={index === props.rows.length}
                  aria-label="Enabled"
                  onChange={(event) => write(index, { enabled: event.currentTarget.checked })}
                />
              </Show>
              <Input
                size="sm"
                value={row().key}
                placeholder={props.keyPlaceholder ?? 'Name'}
                onInput={(event) => write(index, { key: event.currentTarget.value })}
              />
              <Input
                size="sm"
                value={row().value}
                placeholder={props.valuePlaceholder ?? 'Value'}
                onInput={(event) => write(index, { value: event.currentTarget.value })}
              />
              <Index each={props.columns ?? []}>
                {(column) => <>{column().render(row(), (patch) => write(index, patch), index)}</>}
              </Index>
              <Show when={index < props.rows.length} fallback={<span />}>
                <Button
                  variant="bare"
                  size="sm"
                  iconOnly
                  aria-label="Remove row"
                  onClick={() => props.onChange(props.rows.filter((_, i) => i !== index))}
                >
                  <Icon name="x" />
                </Button>
              </Show>
            </div>
            <Show when={props.rowHint?.(row())}>
              {(hint) => <p class="ui-kvgrid-hint">{hint()}</p>}
            </Show>
          </>
        )}
      </Index>
    </div>
  )
}
