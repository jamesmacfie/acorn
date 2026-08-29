// The API panel (docs/http-client.md § Client: the `http` and `http-project` surfaces). Mounted
// twice: as the project-scoped surface beside the rail list (project tree, no task) and as a task
// pane (that task's ad-hoc requests on top of the project tree). Everything below is shared between
// them; the only difference is taskId.
//
// The split is a `ListDetail` inside one tree rather than two regions of a `list-detail` pane layout,
// and that is not a preference: the two columns share the selection, the draft and the send result, and
// two regions are two renderers with no way to hold one signal between them.
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import {
  Button, createArmedConfirm, DetailColumn, EmptyState, Icon, Input, Inline, ListColumn, ListDetail,
  SectionHeader, Section, Select, Stack, StatusDot, Text, Toolbar, ToolbarSpacer, TreeRow,
} from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { fromCurl, httpMethods, toCurl, type HttpRequest, type SendResult } from '../shared/model'
import { createRequest, deleteRequest, listRequests, sendRequest, updateRequest } from './httpClient'
import { draftsDiffer, emptyDraft, toDraft, toSendInput, type Draft } from './draft'
import RequestTabs from './RequestTabs'
import ResponseView from './ResponseView'
import HttpVariables from './HttpVariables'
import SaveRequestModal, { type SaveTarget } from './SaveRequestModal'

type Selection = { kind: 'saved'; id: string } | { kind: 'new' } | { kind: 'variables' }

// Requests carry a slash path ('auth/login'), not a folder id: grouping is a client-side split.
// A folder therefore exists exactly as long as something is filed in it.
type Group = { folder: string; requests: HttpRequest[] }

function groupByFolder(requests: HttpRequest[]): Group[] {
  const byFolder = new Map<string, HttpRequest[]>()
  for (const r of requests) {
    const list = byFolder.get(r.folder) ?? []
    list.push(r)
    byFolder.set(r.folder, list)
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([folder, list]) => ({ folder, requests: list.sort((a, b) => a.name.localeCompare(b.name)) }))
}

export default function HttpPanel(props: {
  bridge: AcornBridge
  projectId: string
  projectName: string
  taskId?: string
  // The rail row this surface was opened on, when it was opened by one. A later row click into the
  // same mounted tree arrives as `bridge.onSelect` instead: the mount props are a snapshot by
  // contract, and remounting per click would discard whatever draft is being edited.
  initialRequestId?: string
}) {
  const blank = () => emptyDraft(props.taskId ?? null)
  const [selection, setSelection] = createSignal<Selection>({ kind: 'new' })
  const [draft, setDraft] = createSignal<Draft>(blank())
  const [result, setResult] = createSignal<SendResult | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [sending, setSending] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saveOpen, setSaveOpen] = createSignal(false)

  const scope = () => ({ projectId: props.projectId, taskId: props.taskId })

  // The repo tree. A task pane also lists that task's ad-hoc requests, in their own group above it.
  const [saved, savedActions] = createResource(scope, (s) => listRequests(s.projectId))
  const [adhoc, adhocActions] = createResource(scope, (s) => (s.taskId ? listRequests(s.projectId, s.taskId) : Promise.resolve([])))

  const refresh = () => {
    void savedActions.refetch()
    void adhocActions.refetch()
  }

  const armedDelete = createArmedConfirm()

  const current = createMemo<HttpRequest | null>(() => {
    const sel = selection()
    if (sel.kind !== 'saved') return null
    return [...(saved() ?? []), ...(adhoc() ?? [])].find((r) => r.id === sel.id) ?? null
  })

  const dirty = createMemo(() => {
    const row = current()
    return row ? draftsDiffer(draft(), toDraft(row)) : draft().url !== ''
  })

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  function open(row: HttpRequest) {
    armedDelete.disarm()
    setSelection({ kind: 'saved', id: row.id })
    setDraft(toDraft(row))
    setResult(null)
    setError(null)
  }

  // A rail selection names a request id; the row itself arrives with the list. An effect rather than
  // mount-time work, because the id can land before the list or after it.
  const [requested, setRequested] = createSignal<string | undefined>(props.initialRequestId)
  onCleanup(props.bridge.onSelect((item) => setRequested(item)))
  createEffect(() => {
    const id = requested()
    if (!id) return
    const row = [...(saved() ?? []), ...(adhoc() ?? [])].find((candidate) => candidate.id === id)
    if (!row) return
    setRequested(undefined)
    open(row)
  })

  function startNew(from?: HttpRequest) {
    setSelection({ kind: 'new' })
    // "Copy an existing request": the same flow as starting from scratch, just pre-filled. An
    // ad-hoc copy belongs to the task, so it drops the folder it came from.
    setDraft(from ? { ...toDraft(from), name: `${from.name} copy`, taskId: props.taskId ?? null, folder: props.taskId ? '' : from.folder } : blank())
    setResult(null)
    setError(null)
  }

  const folders = createMemo(() => [...new Set((saved() ?? []).map((r) => r.folder).filter(Boolean))].sort())

  const saveTarget = createMemo<SaveTarget>(() => ({
    name: draft().name,
    folder: draft().folder,
    scope: draft().taskId ? 'task' : 'project',
  }))

  // `error` is shared with the send path, and the dialog shows it. Don't open onto a stale one.
  const openSave = () => {
    setError(null)
    setSaveOpen(true)
  }

  // Saving an existing request writes straight through: its name and home are already settled.
  // Anything else (a new request, or a rename/move via the name button) asks first.
  const onSaveClick = () => (current() ? void persist(draft()) : openSave())

  async function persist(d: Draft) {
    if (!d.name.trim()) return setError('Give the request a name before saving.')
    setSaving(true)
    setError(null)
    try {
      const row = current()
      const next = row ? await updateRequest(props.projectId, row.id, d) : await createRequest(props.projectId, d)
      setSelection({ kind: 'saved', id: next.id })
      setDraft(toDraft(next))
      setSaveOpen(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the request')
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: HttpRequest) {
    if (!armedDelete.request(row.id)) return
    try {
      await deleteRequest(props.projectId, row.id)
      if (current()?.id === row.id) startNew()
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the request')
    }
  }

  async function fire() {
    if (!draft().url.trim()) return setError('Enter a URL first.')
    setSending(true)
    setError(null)
    setResult(null)
    try {
      // The panel decides where commands run (docs/http-client.md § Data model).
      setResult(await sendRequest(props.projectId, toSendInput(draft(), props.taskId ?? null)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSending(false)
    }
  }

  /**
   * The URL bar committed. A curl command pasted in expands into the whole request, as Bruno does.
   *
   * On commit rather than on paste, and that is the one visible difference the move to a tree cost
   * here: a paste event is a DOM event, so it cannot cross to a sandbox that has no DOM. Pressing
   * Enter or leaving the field does the expansion instead, which is one keystroke later and the same
   * result (docs/http-client.md § Client).
   */
  function commitUrl(value: string): boolean {
    if (/^\s*curl\s/i.test(value)) {
      const parsed = fromCurl(value)
      if (parsed) {
        patch({ method: parsed.method, url: parsed.url, headers: parsed.headers, bodyMode: parsed.bodyMode, body: parsed.body, auth: parsed.auth })
        return true
      }
    }
    patch({ url: value })
    return false
  }

  // Through the bridge, not `navigator.clipboard` (docs/http-client.md § Client).
  async function copyAsCurl() {
    await props.bridge.ui.copy(toCurl(draft()))
  }

  const groups = createMemo(() => groupByFolder(saved() ?? []))

  return (
    <ListDetail split listLabel="Requests">
      <ListColumn label="Requests">
        <SectionHeader level="pane">{props.projectName}</SectionHeader>
        <Toolbar variant="actions" size="sm">
          <Button size="sm" variant="ghost" onPress={() => startNew()}>+ Request</Button>
        </Toolbar>

        <Stack gap="row">
          <Show when={props.taskId}>
            <Section label="This task">
              <Show
                when={(adhoc() ?? []).length}
                fallback={<EmptyState align="start" size="sm">Nothing yet — new requests you make here stay with this task until you file them.</EmptyState>}
              >
                <For each={adhoc()}>{(row) => <RequestRow row={row} active={current()?.id === row.id} armed={armedDelete.armed() === row.id} onOpen={open} onCopy={startNew} onDelete={remove} />}</For>
              </Show>
            </Section>
          </Show>

          <For each={groups()}>
            {(group) => (
              <Section label={group.folder || 'Ungrouped'}>
                <For each={group.requests}>{(row) => <RequestRow row={row} active={current()?.id === row.id} armed={armedDelete.armed() === row.id} onOpen={open} onCopy={startNew} onDelete={remove} />}</For>
              </Section>
            )}
          </For>

          <Show when={saved.state === 'ready' && !(saved() ?? []).length && !props.taskId}>
            <EmptyState align="start" size="sm">No saved requests for this project yet.</EmptyState>
          </Show>
        </Stack>

        <Toolbar variant="actions" size="sm">
          <Button
            size="sm"
            variant={selection().kind === 'variables' ? 'solid' : 'bare'}
            onPress={() => setSelection({ kind: 'variables' })}
          >
            <Icon name="braces" /> Variables
          </Button>
        </Toolbar>
      </ListColumn>

      <DetailColumn>
        <Show
          when={selection().kind !== 'variables'}
          fallback={<HttpVariables projectId={props.projectId} projectName={props.projectName} />}
        >
          <Toolbar ariaLabel="Request">
            <Select
              width="narrow"
              value={draft().method}
              label="Method"
              onChange={(value: string) => patch({ method: value })}
              options={[...httpMethods.map((m) => ({ value: m, label: m }))]}
            />
            <Input
              value={draft().url}
              placeholder="{{BASE_URL}}/users  ·  or paste a curl command"
              assist={false}
              label="URL"
              onChange={commitUrl}
              onSubmit={(value: string) => {
                // A curl command that just expanded is not a request to send: the reader pressed Enter
                // to fill the fields in, and firing on the same keystroke would send the old URL.
                if (!commitUrl(value)) void fire()
              }}
            />
            <Button variant="solid" tone="accent" busy={sending()} onPress={() => void fire()}>
              Send
            </Button>
          </Toolbar>

          <Toolbar size="sm" ariaLabel="Request meta">
            {/* The name is a label, not a field: it opens the save dialog, which is also the rename
                and the move-into-the-repo path. */}
            <Button variant="bare" size="sm" title="Rename, move or file this request" onPress={openSave}>
              <Show when={draft().folder}>
                <Text emphasis="muted">{draft().folder}/</Text>
              </Show>
              <Text>{draft().name || 'Untitled request'}</Text>
              <Show when={draft().taskId}><Text emphasis="eyebrow">task</Text></Show>
            </Button>
            <ToolbarSpacer />
            <Show when={dirty()}>
              <StatusDot tone="accent" label="Unsaved changes" />
            </Show>
            <Button size="sm" variant="ghost" onPress={() => void copyAsCurl()}>
              Copy as curl
            </Button>
            <Button size="sm" busy={saving()} onPress={onSaveClick}>
              {current() ? 'Save' : 'Save…'}
            </Button>
          </Toolbar>

          <RequestTabs draft={draft()} patch={patch} />
          <ResponseView result={result()} error={error()} sending={sending()} onCopy={(text) => void props.bridge.ui.copy(text)} />
        </Show>

        <Show when={saveOpen()}>
          <SaveRequestModal
            target={saveTarget()}
            inTask={!!props.taskId}
            folders={folders()}
            busy={saving()}
            error={error()}
            onDismiss={() => setSaveOpen(false)}
            onSave={(target) => {
              const next: Draft = {
                ...draft(),
                name: target.name,
                // A task-scoped request has no folder: the task is its home.
                folder: target.scope === 'project' ? target.folder : '',
                taskId: target.scope === 'task' ? (props.taskId ?? null) : null,
              }
              setDraft(next)
              void persist(next)
            }}
          />
        </Show>
      </DetailColumn>
    </ListDetail>
  )
}

// Named RequestRow because the shared component owns the name TreeRow. This adapter adds the leading
// method label and the two row actions.
//
// The method chip's colour-per-verb went with the stylesheet: a plugin no longer names a colour, and
// the kit has no role that means "POST". The verb is still the first thing on the row, in mono.
function RequestRow(props: { row: HttpRequest; active: boolean; armed: boolean; onOpen: (row: HttpRequest) => void; onCopy: (row: HttpRequest) => void; onDelete: (row: HttpRequest) => void }) {
  return (
    <TreeRow
      depth={1}
      reveal
      selected={props.active}
      onPress={() => props.onOpen(props.row)}
      leading={props.row.method}
    >
      <Inline>
        <Text>{props.row.name}</Text>
        <Button variant="bare" size="sm" title="Duplicate as a new request" label="Duplicate" onPress={() => props.onCopy(props.row)}>
          <Icon name="copy" />
        </Button>
        {/* Two clicks, not a dialog. The label changes so the second click is not a surprise, and it is
            the affordance rather than a tooltip because a tooltip is not an answer to "did that do
            anything". */}
        <Button
          variant="bare"
          size="sm"
          tone={props.armed ? 'danger' : undefined}
          title={props.armed ? `Click again to delete "${props.row.name}"` : 'Delete'}
          label={props.armed ? 'Confirm delete' : 'Delete'}
          onPress={() => props.onDelete(props.row)}
        >
          <Show when={props.armed} fallback={<Icon name="trash-2" />}>Delete?</Show>
        </Button>
      </Inline>
    </TreeRow>
  )
}
