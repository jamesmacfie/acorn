import { createSignal, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { checkCloneUrl, cloneFolderProblem } from '@acorn/protocol/api.ts'
import type { ProjectImporterProps } from '../../host/registries/sources/projectImporters'
import { activeNodeId } from '../../infra/node/activeNode'
import { clientCapability } from '../../infra/node/clientCapabilities'
import { Alert, Button, Card, Field, Input } from '../../kit/components/primitives'
import { Heading } from '../../kit/components/content/Heading'
import { Text } from '../../kit/components/content/Text'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { Inline } from '../../kit/components/layout/Inline'
import { Stack } from '../../kit/components/layout/Stack'
import { canAddProjectFromFolder, pickNodeFolder } from './addProject'
import { CLONE_FOLLOW_UP, type CloneFollowUpChoice } from './cloneFollowUp'
import { createCloneRun, lastCloneParent } from './cloneRun'

// Clone from URL, core's own project importer (docs/workspaces-and-tasks/clone-runs.md § Clone from
// URL). The host mounts it for one Node and drops it when the Node changes, which stops following
// the clone but doesn't stop it.
//
// No workspace: the Node files the clone under Default, as it does a folder added from these screens.
export default function CloneFromUrl(props: ProjectImporterProps) {
  const nodeId = activeNodeId()
  const [url, setUrl] = createSignal('')
  const [parent, setParent] = createSignal(lastCloneParent(nodeId))
  // Null until edited, so the name follows the URL until then.
  const [typedName, setTypedName] = createSignal<string | null>(null)
  const [error, setError] = createSignal('')
  const [cloned, setCloned] = createSignal('')
  const clone = createCloneRun()
  // A workflow to run after the clone, when the workflows plugin offers one.
  const followUp = () => clientCapability(CLONE_FOLLOW_UP)
  const [choice, setChoice] = createSignal<CloneFollowUpChoice | null>(null)
  const [launching, setLaunching] = createSignal(false)

  const checked = () => checkCloneUrl(url().trim())
  const urlProblem = () => {
    const result = checked()
    return url().trim() && 'error' in result ? result.error : ''
  }
  const name = () => {
    const result = checked()
    return typedName() ?? ('folder' in result ? result.folder : '')
  }
  const running = () => clone.elapsed() !== null || launching()
  const ready = () =>
    !running() &&
    (choice()?.ready ?? true) &&
    'folder' in checked() &&
    !!parent().trim() &&
    !cloneFolderProblem(name().trim())

  const chooseParent = async () => {
    const folder = await pickNodeFolder(nodeId)
    if (folder) setParent(folder)
  }

  const submit = async () => {
    if (!ready()) return
    const folder = name().trim()
    setError('')
    setCloned('')
    const request = { url: url().trim(), parentDir: parent().trim(), name: folder }
    const then = choice()
    if (then) setLaunching(true)
    const result = then
      ? await then.start(request).finally(() => setLaunching(false))
      : await clone.start(nodeId, request)
    if (!result) return
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (!then) setCloned(`Cloned ${folder}. It's untrusted until you trust it in its settings.`)
    props.onImported([result.projectId])
  }

  const form = () => (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Stack gap="stack">
        <Field label="Git URL" error={urlProblem() || undefined}>
          <Input
            value={url()}
            onInput={setUrl}
            placeholder="https://github.com/owner/repository.git"
            disabled={running()}
            invalid={!!urlProblem()}
          />
        </Field>
        <Field label="Parent folder on this Node">
          <Inline gap="row">
            <Input value={parent()} onInput={setParent} placeholder="/absolute/path/on/node" disabled={running()} />
            <Show when={canAddProjectFromFolder()}>
              <Button disabled={running()} onPress={() => void chooseParent()}>
                Choose folder…
              </Button>
            </Show>
          </Inline>
        </Field>
        <Field label="Folder name">
          <Input value={name()} onInput={setTypedName} disabled={running()} />
        </Field>
        <Show when={followUp()}>
          {(offer) => <Dynamic component={offer().Picker} nodeId={nodeId} disabled={running()} onChange={setChoice} />}
        </Show>
        <Inline gap="row">
          <Button submit variant="solid" disabled={!ready()}>
            {choice()?.label ?? 'Clone'}
          </Button>
          <Show when={clone.elapsed()}>
            {(elapsed) => (
              <Text tone="muted">
                Cloning {name().trim()}… {elapsed()}
              </Text>
            )}
          </Show>
        </Inline>
        <Show when={error()}>
          <Alert>{error()}</Alert>
        </Show>
        <Show when={cloned()}>
          <Alert tone="ok">{cloned()}</Alert>
        </Show>
      </Stack>
    </form>
  )

  return (
    <Show when={props.showClose !== false} fallback={form()}>
      <Card>
        <Stack gap="stack">
          <Inline spread>
            <Heading level={3}>Clone from URL</Heading>
            <IconButton icon="x" label="Close" onPress={props.onClose} />
          </Inline>
          {form()}
        </Stack>
      </Card>
    </Show>
  )
}
