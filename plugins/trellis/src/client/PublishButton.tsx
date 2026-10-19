import { createSignal, Show } from 'solid-js'
import { Button, Modal, ModalActions, ModalBody, Text } from '@acorn/plugin-api/ui'
import { activeNodeId, writeJson } from '@acorn/plugin-api/client'
import { appPublishRoute, type AppListing, type PublishMode } from '../shared/api'
import { appById, refreshApps } from './appsStore'

// Publish to project on a task app, and Publish on a draft
// (docs/agent-built-apps/project-apps.md § Publishing). When the project app moved since the draft
// started, the Node refuses, and the person chooses here.

export function PublishButton(props: { app: AppListing }) {
  const nodeId = activeNodeId() ?? ''
  const [busy, setBusy] = createSignal(false)
  const [conflict, setConflict] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  // The project app this draft publishes to. A deleted or removed one isn't, so the draft publishes as
  // a new app.
  const target = () => {
    const linked = props.app.draftOf ? appById(props.app.draftOf.appId) : undefined
    return linked && !linked.deletedAt ? linked : undefined
  }
  const published = () => !!target() && props.app.head === props.app.draftOf?.head

  const publish = async (mode: PublishMode) => {
    setBusy(true)
    setConflict(false)
    setFailed(false)
    try {
      await writeJson(appPublishRoute(props.app.appId), {
        method: 'POST',
        nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
    } catch (error) {
      if ((error as { status?: unknown } | null)?.status === 409) setConflict(true)
      else setFailed(true)
    } finally {
      // Both outcomes change the listing: a new head, or the project app's head the modal names.
      await refreshApps().catch(() => undefined)
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        busy={busy()}
        disabled={published()}
        tip={published() ? 'The project has this version' : undefined}
        onPress={() => void publish('safe')}
      >
        {target() ? 'Publish' : 'Publish to project'}
      </Button>
      <Show when={failed()}>
        <Text tone="danger">Couldn't publish. Try again.</Text>
      </Show>
      <Show when={conflict() && target()}>
        {(project) => (
          <Modal title={`${project().name} changed`} size="sm" onDismiss={() => setConflict(false)}>
            <ModalBody>
              <Text wrap>
                {`The project's app is at v${project().head}, and this draft started from v${props.app.draftOf!.revision}. Publish this draft as a new app, or replace v${project().head} with it.`}
              </Text>
            </ModalBody>
            <ModalActions>
              <Button variant="ghost" onPress={() => setConflict(false)}>
                Cancel
              </Button>
              <Button variant="outline" onPress={() => void publish('new')}>
                Publish as a new app
              </Button>
              <Button variant="solid" tone="danger" onPress={() => void publish('replace')}>
                Replace anyway
              </Button>
            </ModalActions>
          </Modal>
        )}
      </Show>
    </>
  )
}
