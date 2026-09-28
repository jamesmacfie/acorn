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
        // The agents composer is a `MentionTextarea` rather than a `Composer`, and it wants the same
        // send. The shared prop calls this "Enter without a modifier", which is the DOM's chat-style
        // Enter; in a terminal Enter in a text field is a newline and nothing else can be, so it is
        // the `commit` chord here — the same key the footer already names beside a focused field.
        {...(props.onSubmit ? { onSubmit: () => props.onSubmit!() } : {})}
        ref={(element: Renderable) => {
          // Landing here is the point of the pane. A reader who opens an agent run has come to write
          // to it, so this field is what entering the region gives the keys to, and the transcript
          // beside it is reached with Escape or Tab (../../keys/regions.ts § markEntry).
          markEntry(element)
          // Two keys that fire while somebody is typing, and the reason is the shape: the field IS
          // the typing target and the list under it is the field's own, so neither can mean "type
          // this" and there is nothing else for them to reach. They say so with their tier: `STOP`
          // sits above the typing shadow, and both are bound to the field itself, which is the one
          // thing the shadow deliberately leaves alone (../../keys/tiers.ts § TYPING). The palette needs
          // the same thing for the same reason and gets it above the trap instead
          // (../../keys/trap.ts § overlayKeys).
          bindKeys(element, [{
            key: 'down',
            cmd: () => {
              if (!list || !suggestions().length) return false
              // Entering the list, not walking it: the field is not one of its stops, so there is
              // nothing to step from (../../keys/regions.ts § walkStops).
              return focusRenderable(stopsIn(list)[0])
            },
          }, {
            // Enter sends, which is what the shared prop has always said this field does: `onSubmit`
            // is documented as "Enter without a modifier. Absent leaves Enter as a newline", and the
            // DOM half reads exactly that (client-core/kit/components/inputs/MentionTextarea.tsx).
            // This host had it on the `commit` chord alone, so the composer's own hint — "Shift+Enter
            // for newline" — described a keyboard nobody had. `commit` still works, and Shift+Return
            // is not this binding, so it falls through to the typing path and inserts the newline.
            //
            // On a terminal that ignores the kitty keyboard protocol there is one byte for both, so
            // Shift+Return sends too and a newline has to come from the ＋ picker or a paste. That is
            // the same terminal on which `ctrl+return` never arrived either (../input/terminal.ts).
            key: 'return',
            cmd: () => {
              // An open list takes it first, and takes the row it is showing at the top — the DOM
              // chooses `suggestions()[selected()]` and lands on the same row when nobody has moved.
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
