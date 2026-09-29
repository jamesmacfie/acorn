/** @jsxImportSource @acorn/tui/jsx */
import { onCleanup, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import { trapKeys } from '../../keys/trap'
import { pushScope } from '../../keys/regions'
import { boxBorder, spaceLines } from '../roles'

/** Draw a bordered modal and contain keys within its scope until it unmounts. */
export function Modal(props: {
  onDismiss: () => void
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'wide'
  align?: 'top' | 'center'
  layout?: 'stack' | 'split'
  role?: 'dialog' | 'alertdialog'
  dismissOn?: readonly ('escape' | 'backdrop')[]
  labelledBy?: string
  children: JSX.Element
}) {
  // The trap follows this component's mount lifetime.
  if (props.dismissOn === undefined || props.dismissOn.includes('escape')) trapKeys(() => props.onDismiss())
  return (
    <box
      flexDirection="column"
      {...boxBorder('surface')}
      title={props.title}
      paddingLeft={1}
      paddingRight={1}
      // Push the scope to focus its first stop and exclude controls behind the modal.
      ref={(element: Renderable) => onCleanup(pushScope(element))}
    >
      {props.children}
    </box>
  )
}

/** The lines between the title rule and the actions line. */
export function ModalBody(props: { children: JSX.Element }) {
  return <box flexDirection="column" flexGrow={1}>{props.children}</box>
}

/** The action row; exported flat and as `Modal.Actions` for kit parity. */
export function ModalActions(props: { children: JSX.Element }) {
  return (
    <box flexDirection="row" gap={1} marginTop={spaceLines('section')}>
      <box flexGrow={1} />
      {props.children}
    </box>
  )
}

Modal.Body = ModalBody
Modal.Actions = ModalActions
