import { createSignal, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import { Alert, Button, Field, Inline, Input, Modal, Stack, Text } from '@acorn/plugin-api/ui'
import {
  activateTaskSignals,
  activeNodeId,
  canAddProjectFromFolder,
  clientCapability,
  openPane,
  pathForTask,
  pickNodeFolder,
} from '@acorn/plugin-api/client'
import { AGENTS_CONVERSATION } from '@acorn/plugin-agents/contract/conversation.ts'
import type { AppListing } from '../shared/api'
import { turnIntoPlugin } from './pluginExport'

/** Turn into a plugin, on a project app's page: asks for an ID, a name, and a folder, then opens the
 *  new task's session. The app itself doesn't change. */
export function TurnIntoPluginButton(props: { app: AppListing; workspaceId: string }) {
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <Button size="sm" variant="ghost" onPress={() => setOpen(true)}>
        Turn into a plugin
      </Button>
      <Show when={open()}>
        <TurnIntoPluginDialog app={props.app} workspaceId={props.workspaceId} onClose={() => setOpen(false)} />
      </Show>
    </>
  )
}

function TurnIntoPluginDialog(props: { app: AppListing; workspaceId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const nodeId = activeNodeId() ?? ''
  const surface = clientCapability(AGENTS_CONVERSATION)
  // A first guess the Node checks against the manifest's ID rule.
  const [pluginId, setPluginId] = createSignal(
    props.app.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  )
  const [name, setName] = createSignal(props.app.name)
  const [folder, setFolder] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  // The picker chooses where the package goes, and the package gets a folder of its own there, as
  // `npm create acorn-plugin` makes one.
  const choose = async () => {
    const parent = await pickNodeFolder(nodeId)
    if (parent) setFolder(`${parent.replace(/[\\/]+$/, '')}/${pluginId()}`)
  }
  const submit = async () => {
    if (!surface) return setError('The agents plugin is off, so no session can start.')
    setBusy(true)
    setError('')
    try {
      const target = { pluginId: pluginId().trim(), name: name().trim(), folder: folder().trim() }
      const { task, sessionId } = await turnIntoPlugin(
        surface,
        queryClient,
        nodeId,
        props.app,
        props.workspaceId,
        target,
      )
      activateTaskSignals(task)
      navigate(pathForTask(task))
      openPane(task.id, 'agents', { kind: 'plugin:select', item: sessionId })
      props.onClose()
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : "Couldn't turn this app into a plugin.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Turn ${props.app.name} into a plugin`} size="md" align="center" onDismiss={props.onClose}>
      <Modal.Body>
        <Stack gap="row">
          <Text emphasis="muted" wrap>
            Acorn writes a plugin package into a new folder, then starts an agent session there that rebuilds this app
            as the plugin's pane. The app stays as it is.
          </Text>
          <Field label="Plugin ID" hint="Lowercase letters, digits, and dashes. It can't change later.">
            <Input value={pluginId()} disabled={busy()} onInput={setPluginId} />
          </Field>
          <Field label="Display name">
            <Input value={name()} disabled={busy()} onInput={setName} />
          </Field>
          <Field label="Folder" hint="A new or empty folder on the Node's computer.">
            <Inline gap="inline">
              <Input value={folder()} placeholder="/path/to/my-plugin" disabled={busy()} onInput={setFolder} />
              <Show when={canAddProjectFromFolder()}>
                <Button disabled={busy()} onPress={() => void choose()}>
                  Choose…
                </Button>
              </Show>
            </Inline>
          </Field>
          <Text emphasis="muted" wrap>
            The agent can't see the app. Paste a screenshot of it with your first message.
          </Text>
          <Show when={error()}>{(message) => <Alert tone="danger">{message()}</Alert>}</Show>
        </Stack>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="ghost" onPress={props.onClose}>
          Cancel
        </Button>
        <Button
          variant="solid"
          tone="accent"
          busy={busy()}
          disabled={!pluginId().trim() || !name().trim() || !folder().trim()}
          onPress={() => void submit()}
        >
          Turn into a plugin
        </Button>
      </Modal.Actions>
    </Modal>
  )
}
