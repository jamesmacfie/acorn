import { createSignal, For, onCleanup, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeNodeId, openPane, type Task } from '@acorn/plugin-api/client'
import {
  Alert,
  Button,
  CodeBlock,
  ConfirmButton,
  EmptyState,
  Only,
  Rectangle,
  SectionHeader,
  Stack,
  Text,
  Textarea,
  Toolbar,
} from '@acorn/plugin-api/ui'
import {
  documentCustody,
  mountEmbeddedEditor,
  recoverDocumentCustody,
  type DocumentCustody,
  type EmbeddedEditor,
} from '@acorn/plugin-api/ui/editor'
import type { ConflictDetail, ConflictResolution } from '../shared/api'
import { conflictKey, conflictOptions, operationActions, operationKey } from './operationClient'

type Props = { task: Task; path: string; checkout: string; onClose: () => void }

/** Base, ours, and theirs beside an editable result. The result is Editor's draft for the same file, shared
 *  through its custody owner, so Editor and this view never hold two drafts of one file. */
export function ConflictResolver(props: Props) {
  const cache = useQueryClient()
  const detail = createQuery(() => conflictOptions(props.task.id, props.path))
  // Outlives a reload, so "saved, but not staged" stays visible beside the refreshed conflict.
  const [notice, setNotice] = createSignal('')
  const refetch = () => void cache.invalidateQueries({ queryKey: conflictKey(props.task.id, props.path) })
  const reload = () => {
    setNotice('')
    refetch()
  }
  const openInEditor = () =>
    openPane(props.task.id, 'editor', { kind: 'editor:reveal', path: props.path, line: 1 }, 'add')
  const notFound = () => (detail.error as { code?: string } | null)?.code === 'not_conflicted'
  return (
    <Stack gap="section">
      <SectionHeader
        actions={
          <Toolbar size="sm" ariaLabel="Conflict actions">
            <Button size="sm" variant="ghost" onPress={props.onClose}>
              Back
            </Button>
            <Button size="sm" variant="ghost" onPress={reload}>
              Reload
            </Button>
            <Button size="sm" variant="ghost" onPress={openInEditor}>
              Open in Editor
            </Button>
          </Toolbar>
        }
      >
        Resolve {props.path}
      </SectionHeader>
      <Show when={notice()}>
        <Alert tone="warn">{notice()}</Alert>
      </Show>
      <Show when={detail.isLoading}>
        <EmptyState title="Reading the conflict" />
      </Show>
      <Show when={notFound()}>
        <EmptyState title="No conflict">This file has no unresolved conflict now. Go back to the operation.</EmptyState>
      </Show>
      <Show when={detail.error && !notFound()}>
        <Alert tone="danger">{String(detail.error)}</Alert>
      </Show>
      {/* Keyed on each read, so a reload binds the draft again against the file it just read. */}
      <Show when={detail.data?.path === props.path ? detail.data : null} keyed>
        {(read) => (
          <Show
            when={!read.unsupported}
            fallback={
              <Alert tone="warn" title="Acorn can't resolve this file as text">
                {read.unsupported}
              </Alert>
            }
          >
            <Resolution {...props} read={read} nodeId={activeNodeId()} onNotice={setNotice} onReload={refetch} />
          </Show>
        )}
      </Show>
    </Stack>
  )
}

function bindDraft(
  address: readonly (string | null)[],
  read: ConflictDetail,
): { custody: DocumentCustody; blocked: string } | { error: string } {
  let custody: DocumentCustody
  try {
    custody =
      recoverDocumentCustody(address) ??
      documentCustody(address, read.result.text ?? '', read.result.revision ?? undefined)
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) }
  }
  const revision = read.result.revision ?? undefined
  if (custody.writeBlock || custody.requiresResolution)
    return { custody, blocked: custody.writeBlock || 'Editor holds a recovered draft of this file.' }
  if (custody.dirty && custody.acknowledgedRevision !== revision)
    return { custody, blocked: 'Editor has unsaved changes made to another version of this file.' }
  // A clean draft follows the file Git left. A dirty one is already the person's work on this version.
  if (!custody.dirty && custody.acknowledgedRevision !== revision) custody.reload(read.result.text ?? '', revision)
  return { custody, blocked: '' }
}

function Resolution(
  props: Props & {
    read: ConflictDetail
    nodeId: string | null
    onNotice: (text: string) => void
    onReload: () => void
  },
) {
  const cache = useQueryClient()
  const bound = bindDraft([props.nodeId, 'file', props.task.id, props.read.path], props.read)
  if ('error' in bound) return <Alert tone="danger">{bound.error}</Alert>
  const { custody } = bound
  onCleanup(custody.retain())
  const [blocked, setBlocked] = createSignal(bound.blocked)
  const [text, setText] = createSignal(custody.current.toString())
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  // The custody revision after this view's last edit. Any other value means Editor typed meanwhile.
  let seen = custody.revision
  let editor: EmbeddedEditor | undefined
  onCleanup(() => editor?.destroy())
  const edit = (next: string) => {
    setText(next)
    custody.editText(next)
    seen = custody.revision
  }
  const take = (next: string) => {
    edit(next)
    editor?.write(next)
  }

  const submit = async (resolution: ConflictResolution['kind']) => {
    setBusy(true)
    setError('')
    const resume = await custody.suspendWrites()
    try {
      if (custody.revision !== seen) {
        take(custody.current.toString())
        setError('The draft changed in Editor. Review it here, then save again.')
        return
      }
      const admitted = custody.revision
      const submitted = custody.current.toString()
      const result = await operationActions.resolve(props.task.id, {
        expectedPath: props.checkout,
        path: props.read.path,
        fingerprint: props.read.fingerprint,
        resolution: resolution === 'text' ? { kind: 'text', text: submitted } : { kind: 'delete' },
      })
      if (result.saved) {
        // A save acknowledges the text Git now holds. A deletion's confirmation said the draft goes too.
        if (resolution === 'text' && result.revision) custody.acknowledgeResolved(submitted, result.revision, admitted)
        else custody.reload('', undefined)
      }
      if (result.state) cache.setQueryData(operationKey(props.task.id), result.state)
      else void cache.invalidateQueries({ queryKey: operationKey(props.task.id) })
      if (result.ok) {
        props.onClose()
        return
      }
      // The saved file has a new fingerprint, so the retry reads it first.
      if (result.saved) {
        props.onNotice(`${result.error ?? 'Saved, but not staged.'} Press Save and stage to retry.`)
        props.onReload()
      } else setError(result.error ?? 'Git refused the resolution.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      void cache.invalidateQueries({ queryKey: operationKey(props.task.id) })
    } finally {
      resume()
      setBusy(false)
    }
  }
  const discard = () => {
    custody.reload(props.read.result.text ?? '', props.read.result.revision ?? undefined)
    take(custody.current.toString())
    setBlocked('')
  }

  return (
    <Show
      when={!blocked()}
      fallback={
        <Alert tone="warn" title="Unsaved Editor changes">
          {blocked()} Save, compare, or discard them in Editor, then reload. Or discard them here and start from the
          file Git left.
          <Toolbar size="sm" ariaLabel="Draft choices">
            <Button
              size="sm"
              variant="ghost"
              onPress={() =>
                openPane(props.task.id, 'editor', { kind: 'editor:reveal', path: props.read.path, line: 1 }, 'add')
              }
            >
              Open in Editor
            </Button>
            <ConfirmButton
              size="sm"
              tone="danger"
              variant="ghost"
              confirmLabel="Discard the unsaved draft?"
              onConfirm={discard}
            >
              Discard draft
            </ConfirmButton>
          </Toolbar>
        </Alert>
      }
    >
      {/* Every side is drawn at once, and no list sits above a control: in the terminal a list keeps
        Down to itself, so a stop after one is reachable only by Tab, which leaves the pane. */}
      <For each={props.read.sides}>
        {(side) => {
          const role = ['Base', 'Ours', 'Theirs'][side.stage - 1]!
          return (
            <Stack gap="row">
              <Text emphasis="muted">
                {role}: {side.label}
                {side.present || side.stage === 1 ? '' : ' deleted this file.'}
              </Text>
              <Show
                when={side.present}
                fallback={
                  side.stage === 1 ? (
                    <Text>No common ancestor has this file: both sides added it.</Text>
                  ) : (
                    <ConfirmButton
                      variant="ghost"
                      tone="danger"
                      disabled={busy()}
                      confirmLabel={`Delete ${props.read.path} and stage it? The result draft is discarded.`}
                      onConfirm={() => void submit('delete')}
                    >
                      Take deletion
                    </ConfirmButton>
                  )
                }
              >
                <CodeBlock size="xs" maxHeight="block">
                  {side.text ?? ''}
                </CodeBlock>
                <Button variant="ghost" disabled={busy()} onPress={() => take(side.text ?? '')}>
                  Use {role.toLowerCase()}
                </Button>
              </Show>
            </Stack>
          )
        }}
      </For>
      <Stack gap="row" grow>
        <Text>Result{props.read.result.present ? '' : ', a new file'}</Text>
        <Show when={error()}>
          <Alert tone="danger">{error()}</Alert>
        </Show>
        {/* Above the result, because the terminal's text box keeps the arrows for its own cursor. */}
        <Button
          busy={busy()}
          disabled={busy()}
          onPress={() => void submit('text')}
          tip="Refused while the result has conflict markers or the file changed since it was read"
        >
          Save and stage
        </Button>
        <Rectangle
          kind="editor"
          label={`Result for ${props.read.path}`}
          mount={(element) => {
            editor = mountEmbeddedEditor(element, { doc: text(), languageId: 'plaintext', onChange: edit })
          }}
        >
          <Only hosts={['tui']}>
            <Textarea grow mono assist={false} label={`Result for ${props.read.path}`} value={text()} onInput={edit} />
          </Only>
        </Rectangle>
      </Stack>
    </Show>
  )
}
