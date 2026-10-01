import { createEffect, Show, splitProps } from 'solid-js'
import { createArmedConfirm } from '../../lib/controls/confirm'
import { Button, type ButtonProps } from './Button'

/* ConfirmButton: arm to confirm. The armed button is the prompt, and it never calls
   window.confirm, which a sandboxed frame silently returns false from.

   `skipConfirm` exists for docker's `confirmDestructive` pref gate. Where the armed state must live
   outside one button, such as a group header arming a row key, use createArmedConfirm directly.

   The prompt is "{Verb} {thing}?", such as "Remove container?". The armed button keeps at least its
   resting width, so a shorter prompt cannot pull the bar in under the pointer before the second
   click. */
export function ConfirmButton(props: ButtonProps & {
  /** The prompt the armed button shows. Name the verb and the thing: "Delete note?". */
  confirmLabel?: string
  timeoutMs?: number
  skipConfirm?: boolean
  onConfirm: () => void
}) {
  const [own, rest] = splitProps(props, ['confirmLabel', 'timeoutMs', 'skipConfirm', 'onConfirm', 'children', 'tone'])
  const armed = createArmedConfirm(() => own.timeoutMs ?? 3000)
  let wrap: HTMLSpanElement | undefined
  const button = () => (wrap?.firstElementChild instanceof HTMLElement ? wrap.firstElementChild : undefined)
  createEffect(() => {
    if (!armed.armed()) button()?.style.removeProperty('min-width')
  })
  // The disarm handlers ride a wrapper rather than the Button, because `blur` and `keydown` are DOM
  // events and no kit node takes one. Both bubble to here (`focusout` is the bubbling form of blur).
  return (
    <span
      class="ui-confirm"
      ref={wrap}
      onFocusOut={() => armed.disarm()}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !armed.armed()) return
        event.preventDefault()
        armed.disarm()
      }}
    >
      <Button
        {...rest}
        tone={armed.armed() ? 'danger' : own.tone}
        armed={!!armed.armed()}
        onPress={() => {
          // Measured before the label swaps, while the button still shows its resting face.
          const resting = button()
          if (!own.skipConfirm && !armed.armed() && resting) resting.style.minWidth = `${resting.offsetWidth}px`
          if (own.skipConfirm || armed.request('self')) own.onConfirm()
        }}
      >
        <Show when={armed.armed()} fallback={own.children}>
          {/* The label is the whole signal that a second click commits, so announce it. */}
          <span aria-live="polite">{own.confirmLabel ?? 'Confirm?'}</span>
        </Show>
      </Button>
    </span>
  )
}
