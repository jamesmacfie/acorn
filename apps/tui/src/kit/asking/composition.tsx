/** @jsxImportSource @acorn/tui/jsx */
import { For, Show, type JSX } from 'solid-js'
import type { MentionTextareaProps } from '@acorn/client-core/kit/components/inputs/MentionTextarea.tsx'
import type { Renderable } from '../../tree/compat'
import { focusRenderable, markEntry, stopsIn } from '../../keys/regions'
import { bindKeys } from '../../keys/install'
import { STOP } from '../../keys/tiers'
import { Line, slot } from '../cells'
import { boxBorder } from '../roles'
import { Button } from './buttons'
import { Textarea } from './fields'
import type { FieldApi } from './fieldRef'
import { PickerRow } from './choices'

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
  let area: (Renderable & FieldApi) | undefined
  // One send, two ways in: `commit` inside the field, and the button. Both read the buffer rather than
  // the prop, because a caller that draws a composer without wiring `onInput` still has the text in
  // front of the reader — and `busy` and `disabled` refuse both, in one place.
  const send = (value?: string) => {
    if (props.disabled || props.busy) return
    props.onSubmit(value ?? (area ? area.plainText : props.value))
  }
  return (
    <box flexDirection="column" {...boxBorder('surface')} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" gap={1}>
        <Line tone="accent">{'>'}</Line>
        <Textarea
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          rows={props.rows ?? 3}
          boxed={false}
          grow
          ref={(element: Renderable) => { area = element as Renderable & FieldApi }}
          onInput={(value) => props.onInput?.(value)}
          onSubmit={(value) => send(value)}
        />
      </box>
      <Show when={props.error}><Line tone="danger">{props.error!}</Line></Show>
      <box flexDirection="row" gap={1}>
        {slot(props.hint)}
        <box flexGrow={1} />
        {slot(props.secondary)}
        <Button tone="accent" disabled={props.disabled || props.busy} onPress={() => send()}>
          {props.submitLabel ?? 'Comment'}
        </Button>
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
  // Completing the word being typed, which is what choosing a suggestion means. The DOM half splices
  // by cursor offset; there is no cursor to ask here, so it replaces the trailing word — which is the
  // same edit for every case `active()` recognises, because that is the word it found.
  const complete = (value: string) => {
    if (!active()) return
    props.onInput(props.value.replace(/\S+$/, `${value} `))
  }
  let list: Renderable | undefined
  return (
    <box flexDirection="column">
      {slot(props.overlay)}
      <Textarea
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        rows={props.rows ?? 3}
        onFocus={props.onFocus}
        // The agents composer uses this field. Its submit prop sends on Enter, while the terminal's
        // ordinary text field uses the commit chord.
        {...(props.onSubmit ? { onSubmit: () => props.onSubmit!() } : {})}
        ref={(element: Renderable) => {
          // Entering the region focuses the composer; Escape or Tab reaches the transcript.
          markEntry(element)
          // Both keys belong to this field, even while typing. STOP outranks the typing shadow.
          bindKeys(element, [{
            key: 'down',
            cmd: () => {
              if (!list || !suggestions().length) return false
              // The field is outside the list's stops, so enter at its first row.
              return focusRenderable(stopsIn(list)[0])
            },
          }, {
            // Enter submits, and Shift+Enter remains a newline when the terminal distinguishes them.
            // Terminals without the kitty keyboard protocol send the same byte for both.
            key: 'return',
            cmd: () => {
              // An open suggestion list takes Enter before the submit handler.
              const [first] = suggestions()
              if (first) { complete(first.value); return true }
              if (!props.onSubmit) return false
              props.onSubmit()
              return true
            },
          }], STOP, { mode: 'focus' })
        }}
        onInput={props.onInput}
      />
      <Show when={suggestions().length}>
        <box flexDirection="column" paddingLeft={2} ref={(element: Renderable) => { list = element }}>
          <For each={suggestions()}>
            {(suggestion) => (
              <PickerRow
                label={suggestion.label}
                description={'detail' in suggestion ? suggestion.detail : undefined}
                onSelect={() => complete(suggestion.value)}
              />
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
