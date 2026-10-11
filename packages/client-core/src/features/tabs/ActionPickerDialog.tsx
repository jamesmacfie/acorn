import { Modal } from '../../kit/components/overlays/Modal'
import { Button } from '../../kit/components/primitives'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'
import { closeActionPicker, type ActionPickerRequest } from '../../host/registries/commands/actionPicker'

export function ActionPickerDialog(props: { request: ActionPickerRequest }) {
  return (
    <Modal title={props.request.title} onDismiss={closeActionPicker}>
      <Modal.Body>
        <Stack gap="row">
          <Text tone="muted" wrap>
            {props.request.detail}
          </Text>
          {props.request.actions.map((action) => (
            <Button
              variant="ghost"
              onPress={() => {
                closeActionPicker()
                action.run()
              }}
            >
              {action.label}
            </Button>
          ))}
        </Stack>
      </Modal.Body>
    </Modal>
  )
}
