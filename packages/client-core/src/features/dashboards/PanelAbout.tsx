import { createMemo, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { DashboardRevision } from '@acorn/protocol/dashboards.ts'
import { inputChain, planOutline } from '@acorn/dashboards-core/outline.ts'
import { REQUIREMENT_STATUS_LABELS } from '@acorn/dashboards-core/labels.ts'
import { Button, Row, SectionHeader } from '../../kit/components/primitives'
import Icon from '../../kit/components/content/Icon'
import { Text } from '../../kit/components/content/Text'
import { Stack } from '../../kit/components/layout/Stack'
import { Modal } from '../../kit/components/overlays/Modal'
import { activeCacheId } from '../../infra/node/activeNode'
import { integrationsOptions } from '../../infra/queries'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { dataSourceCatalogOptions } from '../dataSources/queries'
import { planInputs } from './planInputs'

// What a published panel does, read-only, from its menu's About this panel
// (docs/dashboards/placements.md § The panel menu). The outline uses the studio's words, so reading it
// here and editing it there say the same thing. A dialog rather than the kit Drawer, which is the
// bottom dock between the rails and not a side panel. A derived source names its plugin and the chain
// of inputs it reads, with the account each one uses.

export default function PanelAbout(props: { revision: DashboardRevision; onEdit: () => void; onDismiss: () => void }) {
  const plan = () => props.revision.content
  const catalog = createQuery(() => dataSourceCatalogOptions(activeCacheId(), {
    ...(props.revision.workspaceId ? { workspaceId: props.revision.workspaceId } : {}),
    ...(props.revision.projectId ? { projectId: props.revision.projectId } : {}), parameters: {},
  }))
  const integrations = createQuery(() => integrationsOptions(true))
  const inputs = createMemo(() => planInputs(plan(), catalog.data?.sources ?? [], integrations.data?.integrations ?? []))
  /** "Release readiness (Northwind), reading Pull requests (GitHub · Work) and Cycle issues (Linear · Acme)". */
  const chain = (key: string): string | undefined => {
    const id = key.slice('source:'.length)
    const listed = inputs()[id]
    const source = plan().sources.find(entry => entry.id === id)
    if (!listed?.length || source?.reference.kind !== 'inline') return undefined
    return `${source.label} (${pluginLabel(source.reference.content.query.source.pluginId)}), reading ${inputChain(listed)}`
  }
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
                  <Show when={chain(part.key) ?? part.detail}>{detail => <Text emphasis="muted" wrap>{detail()}</Text>}</Show>
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
