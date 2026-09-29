/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, Show, type JSX } from 'solid-js'
import { boxBorder } from '../roles'

/** reduced: the panel opens as a full-width block under its anchor, not floating. That is the whole
 *  loss, and it is the one every terminal overlay takes. */
export function Popover(props: {
  trigger: (state: { open: () => boolean; toggle: () => void }) => JSX.Element
  placement?: string
  minWidth?: number | 'anchor'
  disabled?: boolean
  role?: 'menu' | 'listbox' | 'dialog'
  ariaLabel?: string
  onDismiss?: () => void
  children: JSX.Element | ((state: { close: () => void }) => JSX.Element)
}) {
  const [open, setOpen] = createSignal(false)
  const close = () => {
    setOpen(false)
    props.onDismiss?.()
  }
  return (
    // The whole line while it is open, for the reason `Menu` gives above. The composer's sent-context
    // preview and the pane header's usage panel are both toolbar children.
    <box flexDirection="column" {...(open() ? { flexBasis: '100%' as const } : {})}>
      {props.trigger({ open, toggle: () => (props.disabled ? undefined : setOpen(!open())) })}
      <Show when={open()}>
        <box flexDirection="column" {...boxBorder('surface')} paddingLeft={1} paddingRight={1}>
          {typeof props.children === 'function' ? props.children({ close }) : props.children}
        </box>
      </Show>
    </box>
  )
}
