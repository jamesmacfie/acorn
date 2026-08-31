/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, For, Index, Show, type JSX } from 'solid-js'
import type { InputRenderable, TextareaRenderable } from '@opentui/core'
import { createArmedConfirm } from '@acorn/client-core/kit/lib/confirm.ts'
import type { Size } from '@acorn/client-core/kit/tokens/tokens.ts'
// The prop types, not the components. A node's props are one contract on both hosts — a pane compiles
// against one of them and runs on either — and this host had hand-written copies that had quietly lost
// `tip`, `iconOnly`, `min` and the rest, so nothing in the roster type-checked
// (docs/future/terminal/phase-6-panes-sweep.md). `import type` is erased, so the DOM components behind
// this module never reach the bundle and the barrel rule holds
// (docs/future/terminal/08-deployables.md).
import type { ButtonProps, InputProps, SelectProps } from '@acorn/client-core/kit/components/primitives.tsx'
import type { PickerProps } from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import type { MentionTextareaProps } from '@acorn/client-core/kit/components/inputs/MentionTextarea.tsx'
import type { ItemProps } from '../keys/collection'
import { flatten, hasNode, Line, slot } from './cells'
import { borderCell } from './roles'
import { Menu } from './grouping'
import { copyToTerminal } from './copy'

// The kit's asking nodes in cells.
//
// Two things are true of every control here and of nothing on the DOM. A control has no intrinsic
// width in a terminal — `Input` draws three characters wide and scrolls its own content unless it is
// told to take the room its row has left — and an edit buffer owns its own text, so a `value` that
// changes from outside has to be written into the renderable rather than passed as a prop.

/** `[ label ]`. `bare` drops the brackets, for a control that is a word inside a sentence. */
export function Button(props: ButtonProps) {
  // A terminal draws the button's words, not its glyph. An icon-only button's child is a node with no
  // text to read off it — `flatten` would print `[object Object]`, which is how the agents pane's
  // header read before the sweep — and the kit makes such a button carry `label`, which is the words
  // (docs/ui-design.md § The closed kit).
  const body = () => (hasNode(props.children) ? props.label ?? '' : flatten(props.children) || props.label || '')
  return (
    <Show when={!props.hidden}>
      <Line
        role={props.pressed || props.armed ? 'strong' : 'body'}
        tone={props.disabled ? 'muted' : props.tone}
      >
        {props.variant === 'bare' ? body() : `[${body()}]`}
      </Line>
    </Show>
  )
}

/** `[ Delete? ]` after the first press: the armed button is the prompt, which is the same rule the
 *  DOM keeps and the same shared helper behind it. */
export function ConfirmButton(props: ButtonProps & {
  confirmLabel?: string
  timeoutMs?: number
  skipConfirm?: boolean
  onConfirm: () => void
}) {
  const armed = createArmedConfirm(() => props.timeoutMs ?? 3000)
  const body = () => flatten(props.children) || props.label || ''
  // One button, so one key: `request` is keyed because the armed state usually lives outside a single
  // control, and this is the degenerate case the DOM's ConfirmButton is too.
  const press = () => {
    if (props.skipConfirm || armed.request('confirm')) props.onConfirm()
  }
  const isArmed = () => armed.armed() !== null
  return (
    <Button
      variant={props.variant}
      tone={isArmed() ? 'danger' : props.tone}
      size={props.size}
      disabled={props.disabled}
      armed={isArmed()}
      onPress={press}
    >
      {isArmed() ? `${props.confirmLabel ?? body()}?` : body()}
    </Button>
  )
}

export function Input(props: InputProps) {
  let field: InputRenderable | undefined
  const text = () => (props.value === undefined ? '' : String(props.value))
  // An edit buffer owns its text once it has it, so a value set from outside is written in and only
  // when it differs. Without the guard every keystroke rewrites the buffer under the cursor.
  createEffect(() => {
    const value = text()
    if (field && field.value !== value) field.value = value
  })
  return (
    <input
      // A `width` role is not a number and should not become one, so the host decides: a field takes
      // the room its row has left, which is what the stylesheet decides on the DOM.
      flexGrow={props.width === 'narrow' ? 0 : 1}
      value={text()}
      placeholder={props.placeholder ?? ''}
      ref={(element: InputRenderable) => { field = element }}
      onInput={(value: string) => props.onInput?.(value)}
      // `unknown`, because the renderable's own option and the reconciler's typed prop disagree about
      // what a submit carries and the intersection accepts only a handler that takes both.
      onSubmit={(value: unknown) => props.onSubmit?.(typeof value === 'string' ? value : text())}
    />
  )
}

export function Textarea(props: {
  size?: Extract<Size, 'sm' | 'md'>
  invalid?: boolean
  width?: 'full' | 'auto' | 'narrow'
  label?: string
  title?: string
  id?: string
  name?: string
  disabled?: boolean
  required?: boolean
  autofocus?: boolean
  assist?: boolean
  value?: string
  placeholder?: string
  rows?: number
  grow?: boolean
  mono?: boolean
  readOnly?: boolean
  maxLength?: number
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  onBlur?: () => void
  onFocus?: () => void
  ref?: unknown
}) {
  let area: TextareaRenderable | undefined
  createEffect(() => {
    const value = props.value ?? ''
    if (area && area.plainText !== value) area.setText(value)
  })
  return (
    <textarea
      flexGrow={props.grow ? 1 : 0}
      // `initialValue`, not a child: a string child of an edit buffer is an orphan text node.
      initialValue={props.value ?? ''}
      placeholder={props.placeholder ?? ''}
      ref={(element: TextareaRenderable) => { area = element }}
      // The change event carries no payload — OpenTUI's own comment on it says to ask the renderable
      // for the text — so this is the one node in the kit that needs a handle on what it drew.
      onContentChange={() => props.onInput?.(area?.plainText ?? '')}
    />
  )
}

/** `[ value ▾ ]`, opening a `Menu`. The list is the menu's; this is the trigger and the value. */
export function Select(props: SelectProps) {
  const current = () => props.options.find((option) => option.value === props.value)
  return (
    <Menu
      ariaLabel={props.label ?? 'Select'}
      trigger={() => <Line tone={props.disabled ? 'muted' : undefined}>{`[ ${current()?.label ?? ''} ▾ ]`}</Line>}
    >
      {() => (
        <For each={props.options}>
          {(option) => (
            <Line
              role={option.value === props.value ? 'match' : 'body'}
              tone={option.disabled ? 'muted' : undefined}
            >
              {option.label}
            </Line>
          )}
        </For>
      )}
    </Menu>
  )
}

/** `[x] label`; Space toggles, through the `select` intent rather than through a key handler here. */
export function Checkbox(props: {
  label?: JSX.Element
  hint?: string
  checked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  switch?: boolean
  size?: Size
  nested?: boolean
  ariaLabel?: string
  title?: string
  id?: string
  name?: string
  onChange?: (checked: boolean) => void
}) {
  const mark = () => (props.indeterminate ? '[-]' : props.checked ? '[x]' : '[ ]')
  return (
    <box flexDirection="row" gap={1}>
      <Line tone={props.disabled ? 'muted' : undefined}>{mark()}</Line>
      <Show when={props.label}><Line>{props.label}</Line></Show>
      <Show when={props.hint}><Line role="muted">{props.hint!}</Line></Show>
    </box>
  )
}

/** `[x] label`, the same two cells as a Checkbox, because in a terminal a switch is a checkbox that
 *  took a different route to the same state. */
export function ToggleButton(props: ButtonProps & { pressed: boolean; onPressedChange: (pressed: boolean) => void }) {
  return (
    <box flexDirection="row" gap={1}>
      <Line tone={props.disabled ? 'muted' : undefined}>{props.pressed ? '[x]' : '[ ]'}</Line>
      <Line tone={props.disabled ? 'muted' : props.tone}>{flatten(props.children) || props.label || ''}</Line>
    </box>
  )
}

/** `( a | [b] | c )`, the selected one in brackets. */
export function SegmentedControl<T extends string>(props: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  size?: Extract<Size, 'sm' | 'md'>
  ariaLabel: string
}) {
  const body = () => `( ${props.options.map((option) => (option.value === props.value ? `[${option.label}]` : option.label)).join(' | ')} )`
  return <Line>{body()}</Line>
}

/** A field that opens a `Menu` filtered by typing. */
export function Picker<T>(props: PickerProps<T>) {
  const [query, setQuery] = createSignal('')
  const rows = () => {
    if (props.items) {
      const needle = query().trim().toLowerCase()
      return props.items
        .filter((item) => !needle || `${item.label} ${item.note ?? ''}`.toLowerCase().includes(needle))
        .map((item) => ({ label: item.label, description: item.note, active: item.active, disabled: item.disabled }))
    }
    return (props.results?.(query()) ?? []).map((item) => ({
      label: props.rowLabel?.(item) ?? '',
      description: props.rowDescription?.(item),
      active: props.isActive?.(item) ?? false,
      disabled: props.isDisabled?.(item) ?? false,
    }))
  }
  return (
    <Menu
      ariaLabel={props.ariaLabel ?? flatten(props.label)}
      trigger={() => <Line tone={props.disabled ? 'muted' : undefined}>{`[ ${flatten(props.label)} ▾ ]`}</Line>}
    >
      {() => (
        <box flexDirection="column">
          <Input kind="filter" placeholder={props.placeholder} value={query()} onInput={setQuery} />
          {slot(props.tools)}
          {slot(props.status)}
          <Show when={rows().length} fallback={<Line role="muted">{props.emptyText}</Line>}>
            <For each={rows()}>
              {(row) => <PickerRow label={row.label} description={row.description} active={row.active} disabled={row.disabled} onSelect={() => {}} />}
            </For>
          </Show>
        </box>
      )}
    </Menu>
  )
}

/** One line in that menu: glyph, label, dim hint. */
export function PickerRow(props: {
  label: string
  description?: string
  active?: boolean
  disabled?: boolean
  leading?: JSX.Element
  role?: 'option'
  onSelect: () => void
  onHover?: () => void
}) {
  return (
    <box flexDirection="row" gap={1}>
      <Line tone="accent">{props.active ? '›' : ' '}</Line>
      {slot(props.leading)}
      <Line tone={props.disabled ? 'muted' : undefined}>{props.label}</Line>
      <Show when={props.description}><Line role="muted">{props.description!}</Line></Show>
    </box>
  )
}

/** A boxed field with a `> ` prompt; commit submits. The prompt is what tells a reader which of the
 *  boxes on screen takes what they type. */
export function Composer(props: {
  value: string
  onInput?: (value: string) => void
  onSubmit: (value: string) => void
  busy?: boolean
  disabled?: boolean
  error?: string
  placeholder?: string
  submitLabel?: string
  secondary?: JSX.Element
  mentions?: string[]
  hint?: JSX.Element
  rows?: number
}) {
  return (
    <box flexDirection="column" border={borderCell('surface').box} borderStyle="single" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" gap={1}>
        <Line tone="accent">{'>'}</Line>
        <Textarea
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          rows={props.rows ?? 3}
          grow
          onInput={(value) => props.onInput?.(value)}
        />
      </box>
      <Show when={props.error}><Line tone="danger">{props.error!}</Line></Show>
      <box flexDirection="row" gap={1}>
        {slot(props.hint)}
        <box flexGrow={1} />
        {slot(props.secondary)}
        <Button tone="accent" disabled={props.disabled || props.busy}>{props.submitLabel ?? 'Comment'}</Button>
      </box>
    </box>
  )
}

/** reduced: no inline highlight of the completed token; the menu is a list under the field. Colouring
 *  a run inside an edit buffer means a mirror element over the field, and a terminal has no layer to
 *  put one on. */
export function MentionTextarea(props: MentionTextareaProps) {
  // The word being typed after a sigil, which is the whole of what the mirror was for.
  const active = () => {
    const sigils = props.sources?.map((source) => source.sigil) ?? (props.mentions ? ['@'] : [])
    const word = /(\S+)$/.exec(props.value)?.[1] ?? ''
    const sigil = sigils.find((candidate) => word.startsWith(candidate))
    return sigil ? { sigil, query: word.slice(sigil.length) } : null
  }
  const suggestions = () => {
    const current = active()
    if (!current) return []
    const source = props.sources?.find((candidate) => candidate.sigil === current.sigil)
    if (source) return source.suggest(current.query)
    return (props.mentions ?? [])
      .filter((name) => name.toLowerCase().includes(current.query.toLowerCase()))
      .slice(0, 8)
      .map((name) => ({ value: `@${name}`, label: name }))
  }
  return (
    <box flexDirection="column">
      {slot(props.overlay)}
      <Textarea
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        rows={props.rows ?? 3}
        onInput={props.onInput}
      />
      <Show when={suggestions().length}>
        <box flexDirection="column" paddingLeft={2}>
          <For each={suggestions()}>
            {(suggestion) => <PickerRow label={suggestion.label} description={'detail' in suggestion ? suggestion.detail : undefined} onSelect={() => {}} />}
          </For>
        </box>
      </Show>
    </box>
  )
}

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

/** fallback: the level is `fallback` because a terminal cannot reach the clipboard portably. Where
 *  the terminal advertises OSC 52 the button works and the level is `full` at runtime; where it does
 *  not, the host prints the value on its own line to copy by hand (./copy.ts). */
export function CopyButton(props: { text: () => string; onCopy?: (text: string) => void; title?: string }) {
  const [shown, setShown] = createSignal(false)
  const copy = () => {
    const text = props.text()
    if (props.onCopy) return props.onCopy(text)
    if (!copyToTerminal(text)) setShown(true)
  }
  return (
    <box flexDirection="column">
      <Button variant="bare" onPress={copy}>⧉</Button>
      <Show when={shown()}><Line role="mono">{props.text()}</Line></Show>
    </box>
  )
}

/** A `Picker` over the connected models, grouped by provider. */
export function ModelConnectionPicker(props: {
  connections: readonly { connection: { id: string; label?: string }; provider: { models?: readonly { id: string; label?: string }[] } }[]
  connectionId: string
  modelId: string
  onChange: (selection: { connectionId: string; modelId: string }) => void
}) {
  const current = () => props.connections.find((entry) => entry.connection.id === props.connectionId) ?? props.connections[0]
  const models = () => current()?.provider.models ?? []
  return (
    <box flexDirection="row" gap={1}>
      <Show when={props.connections.length > 1}>
        <Select
          label="Connection"
          value={props.connectionId}
          options={props.connections.map((entry) => ({ value: entry.connection.id, label: entry.connection.label ?? entry.connection.id }))}
          onChange={(connectionId) => props.onChange({ connectionId, modelId: props.modelId })}
        />
      </Show>
      <Select
        label="Model"
        value={props.modelId}
        options={models().map((model) => ({ value: model.id, label: model.label ?? model.id }))}
        onChange={(modelId) => props.onChange({ connectionId: props.connectionId, modelId })}
      />
    </box>
  )
}

export type { ItemProps }
