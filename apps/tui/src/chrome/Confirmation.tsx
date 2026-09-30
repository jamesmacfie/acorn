/** @jsxImportSource @acorn/tui/jsx */
import { Show } from 'solid-js'
import { Line } from '../kit/cells'
import { Row, Rows } from '../kit/showing'
import { Modal, ModalBody } from '../kit/grouping'
import { finishConfirmation, type ConfirmRequest } from './confirmStore'

// A fresh collection id per dialog. The caret is kept per id across mounts, so one id for every dialog
// would open the next question on whichever answer the last one was given.
let asked = 0

/** The question, what goes, what stays, and the two answers as a list. A list rather than two buttons,
 *  for the reason the quit dialog gives: the choice is one stop, and the caret starts on Cancel, so
 *  Enter pressed out of habit keeps everything (./Shell.tsx § QuitConfirm). */
export function Confirmation(props: { request: ConfirmRequest }) {
  const answer = (confirmed: boolean) => finishConfirmation(confirmed)
  const id = `chrome.confirm.${++asked}`
  return (
    <Modal onDismiss={() => answer(false)} title={props.request.title} size="md" role="alertdialog">
      <ModalBody>
        <box flexDirection="column">
          <Line wrap>{props.request.goes}</Line>
          <Show when={props.request.stays}><Line role="muted" wrap>{props.request.stays!}</Line></Show>
          <Rows
            id={id}
            ariaLabel={props.request.title}
            items={[{ key: 'cancel', label: 'Cancel' }, { key: 'confirm', label: props.request.actionLabel }]}
            onActivate={(key) => answer(key === 'confirm')}
          >
            {(row, item) => <Row item={item}>{row.label}</Row>}
          </Rows>
        </box>
      </ModalBody>
    </Modal>
  )
}
