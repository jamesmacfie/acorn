/** @jsxImportSource @acorn/tui/jsx */
import { closeActionPicker, type ActionPickerRequest } from '@acorn/client-core/host/registries/commands'
import { Line } from '../kit/cells'
import { Modal, ModalBody } from '../kit/grouping'
import { Row, Rows } from '../kit/showing'

export default function ActionPickerHost(props: { request: ActionPickerRequest }) {
  const items = props.request.actions.map((action) => ({ key: action.id, label: action.label }))
  const select = (key: string) => {
    const action = props.request.actions.find((entry) => entry.id === key)
    closeActionPicker()
    action?.run()
  }
  return (
    <Modal title={props.request.title} onDismiss={closeActionPicker}>
      <ModalBody>
        <Line role="muted">{props.request.detail}</Line>
        <Rows id="host.action-picker" ariaLabel={props.request.title} items={items} onActivate={select}>
          {(item, itemProps) => (
            <Row item={itemProps} onPress={() => select(item.key)}>
              {item.label}
            </Row>
          )}
        </Rows>
      </ModalBody>
    </Modal>
  )
}
