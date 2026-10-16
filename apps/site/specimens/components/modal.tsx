import { Button, Modal, ModalActions, ModalBody, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Modal, ModalBody, and ModalActions',
  caption: 'A small dialog asking before it deletes a branch.',
  terminal: { columns: 60, rows: 5 },
  width: 480,
}

export default function ModalSpecimen() {
  return (
    <Modal title="Delete fix-login-redirect?" size="sm" onDismiss={() => {}}>
      <ModalBody>
        <Text>The branch has two commits that aren't on main.</Text>
      </ModalBody>
      <ModalActions>
        <Button label="Cancel" variant="ghost" />
        <Button label="Delete" variant="solid" tone="danger" />
      </ModalActions>
    </Modal>
  )
}
