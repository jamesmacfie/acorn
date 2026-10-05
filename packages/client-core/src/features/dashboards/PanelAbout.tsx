import { For, Show } from 'solid-js'
import type { DashboardRevision } from '@acorn/protocol/dashboards.ts'
import { planOutline } from '@acorn/dashboards-core/outline.ts'
import { REQUIREMENT_STATUS_LABELS } from '@acorn/dashboards-core/labels.ts'
import { Button, Row, SectionHeader } from '../../kit/components/primitives'
import Icon from '../../kit/components/content/Icon'
import { Text } from '../../kit/components/content/Text'
import { Stack } from '../../kit/components/layout/Stack'
import { Modal } from '../../kit/components/overlays/Modal'

// What a published panel does, read-only, from its menu's About this panel
// (docs/dashboards/placements.md § The panel menu). The outline uses the studio's words, so reading it
// here and editing it there say the same thing. A dialog rather than the kit Drawer, which is the
// bottom dock between the rails and not a side panel.

export default function PanelAbout(props: { revision: DashboardRevision; onEdit: () => void; onDismiss: () => void }) {
  const plan = () => props.revision.content
  return (
    <Modal title="About this panel" size="md" onDismiss={props.onDismiss}>
      <Modal.Body>
        <Stack gap="row">
          <Text>{plan().title}</Text>
          <Stack gap="none">
            <For each={planOutline(plan())}>{part => (
              <Row density="compact" variant="stacked" leading={<Icon name={part.icon} />}>
                <Stack gap="none">
                  <Text>{part.title}</Text>
                  <Show when={part.detail}>{detail => <Text emphasis="muted">{detail()}</Text>}</Show>
                </Stack>
              </Row>
            )}</For>
          </Stack>
          <Show when={plan().request}>{request => <>
            <SectionHeader level="group">Asked for</SectionHeader>
            <Text wrap>{request()}</Text>
          </>}</Show>
          <Show when={plan().requirements?.length}>
            <SectionHeader level="group">Requirements</SectionHeader>
            <Stack gap="none">
              <For each={plan().requirements}>{item => (
                <Row density="compact" variant="stacked">
                  <Stack gap="none">
                    <Text wrap>{`${REQUIREMENT_STATUS_LABELS[item.status]}: ${item.text}`}</Text>
                    <Show when={item.reason}>{reason => <Text emphasis="muted" wrap>{reason()}</Text>}</Show>
                  </Stack>
                </Row>
              )}</For>
            </Stack>
          </Show>
          <Text emphasis="muted">{`Revision ${props.revision.revision}, published ${new Date(props.revision.createdAt).toLocaleString()}`}</Text>
        </Stack>
      </Modal.Body>
      <Modal.Actions>
        <Button size="sm" onPress={props.onEdit}>Edit…</Button>
      </Modal.Actions>
    </Modal>
  )
}
