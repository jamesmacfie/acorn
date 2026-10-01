/** @jsxImportSource @acorn/tui/jsx */
import { Show, splitProps } from 'solid-js'
import type { ButtonProps } from '@acorn/client-core/kit/components/primitives.tsx'
import { createArmedConfirm } from '@acorn/client-core/kit/lib/confirm'
import { stop } from '../../keys/stops'
import { flatten, hasNode, Line } from '../cells'
import { litControl } from '../roles'

/** `[ label ]`. `bare` drops the brackets, for a control that is a word inside a sentence. */
export function Button(props: ButtonProps) {
  // A terminal draws the button's words, not its glyph. An icon-only button's child is a node with no
  // text to read off it — `flatten` would print `[object Object]`, which is how the agents pane's
  // header read before the sweep — and the kit makes such a button carry `label`, which is the words
  // (docs/ui-design.md § The closed kit).
  const body = () => (hasNode(props.children) ? props.label ?? '' : flatten(props.children) || props.label || '')
  const control = stop({
    onPress: () => props.onPress?.(),
    disabled: () => !!props.disabled,
  })
  return (
    <Show when={!props.hidden}>
      {/* A box around the line, because the keys are bound to a renderable and a `Line` may be a tree
          the caller handed in. A row containing one run of text is as wide as the run. */}
      <box flexDirection="row" flexShrink={0} ref={control.ref}>
        <Line {...litControl({
          focused: control.focused(),
          strong: props.pressed || props.armed,
          disabled: props.disabled,
          tone: props.tone,
        })}>
          {props.variant === 'bare' ? body() : `[${body()}]`}
        </Line>
      </box>
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
  const body = () => (hasNode(props.children) ? props.label ?? '' : flatten(props.children) || props.label || '')
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

/** A terminal action uses its label. The icon name belongs to the shared DOM contract, but no SVG
 *  reaches this host and a substituted symbol would hide the action's meaning. */
export function IconButton(props: Omit<ButtonProps, 'children' | 'iconOnly' | 'label'> & {
  icon: string
  label: string
  spin?: boolean
}) {
  const [, rest] = splitProps(props, ['icon', 'spin'])
  return <Button {...rest} variant={rest.variant ?? 'bare'} label={props.label} />
}
