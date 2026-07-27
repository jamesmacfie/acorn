// The API panel. Mounted twice: as the left-rail Source (repo tree, no task) and as a task pane
// (that task's ad-hoc requests on top of the repo tree). Everything below is shared between them —
// the only difference is `taskId`.
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { Button, Input, Select, SectionHeader } from '../../../core/client/ui/primitives'
import Icon from '../../../core/client/ui/Icon'
import { fromCurl, httpMethods, toCurl, type HttpRequest, type SendResult } from '../shared/model'
import { createRequest, deleteRequest, listRequests, sendRequest, updateRequest } from './httpClient'
import { draftsDiffer, emptyDraft, toDraft, type Draft } from './draft'
import RequestTabs from './RequestTabs'
import ResponseView from './ResponseView'
import HttpVariables from './HttpVariables'
import './http.css'

type Selection = { kind: 'saved'; id: string } | { kind: 'new' } | { kind: 'variables' }

// Requests carry a slash path ('auth/login'), not a folder id — grouping is a client-side split.
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

const methodTone = (method: string): string => method.toLowerCase()

export default function HttpPanel(props: { owner: string; repo: string; taskId?: string }) {
  const [selection, setSelection] = createSignal<Selection>({ kind: 'new' })
  const [draft, setDraft] = createSignal<Draft>(emptyDraft(props.taskId ?? null))
  const [result, setResult] = createSignal<SendResult | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [sending, setSending] = createSignal(false)
  const [saving, setSaving] = createSignal(false)

  const scope = () => ({ owner: props.owner, repo: props.repo, taskId: props.taskId })

  // The repo tree. A task pane also lists that task's ad-hoc requests, in their own group above it.
  const [saved, savedActions] = createResource(scope, (s) => listRequests(s.owner, s.repo))
  const [adhoc, adhocActions] = createResource(scope, (s) => (s.taskId ? listRequests(s.owner, s.repo, s.taskId) : Promise.resolve([])))

  const refresh = () => {
    void savedActions.refetch()
    void adhocActions.refetch()
  }

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
    setSelection({ kind: 'saved', id: row.id })
    setDraft(toDraft(row))
    setResult(null)
    setError(null)
  }

  function startNew(from?: HttpRequest) {
    setSelection({ kind: 'new' })
    // "Copy an existing request" — the same flow as starting from scratch, just pre-filled. An
    // ad-hoc copy belongs to the task, so it drops the folder it came from.
    setDraft(from ? { ...toDraft(from), name: `${from.name} copy`, taskId: props.taskId ?? null, folder: props.taskId ? '' : from.folder } : emptyDraft(props.taskId ?? null))
    setResult(null)
    setError(null)
  }

  async function save() {
    const d = draft()
    if (!d.name.trim()) return setError('Give the request a name before saving.')
    setSaving(true)
    setError(null)
    try {
      const row = current()
      const next = row ? await updateRequest(props.owner, props.repo, row.id, d) : await createRequest(props.owner, props.repo, d)
      setSelection({ kind: 'saved', id: next.id })
      setDraft(toDraft(next))
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the request')
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: HttpRequest) {
    if (!confirm(`Delete "${row.name}"?`)) return
    try {
      await deleteRequest(props.owner, props.repo, row.id)
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
      setResult(await sendRequest(props.owner, props.repo, draft()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSending(false)
    }
  }

  // Pasting a curl command into the URL bar fills in the whole request — Bruno does the same, and
  // it is by far the fastest way to get something from a terminal or a browser's devtools into here.
  function onUrlPaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text') ?? ''
    if (!/^\s*curl\s/i.test(text)) return
    const parsed = fromCurl(text)
    if (!parsed) return
    event.preventDefault()
    patch({ method: parsed.method, url: parsed.url, headers: parsed.headers, bodyMode: parsed.bodyMode, body: parsed.body, auth: parsed.auth })
  }

  async function copyAsCurl() {
    await navigator.clipboard.writeText(toCurl(draft()))
  }

  const groups = createMemo(() => groupByFolder(saved() ?? []))

  return (
    <div class="http-panel">
      <aside class="http-sidebar">
        <SectionHeader level="pane" actions={<Button size="sm" variant="ghost" onClick={() => startNew()}>+ Request</Button>}>
          {props.repo}
        </SectionHeader>

        <nav class="http-tree">
          <Show when={props.taskId}>
            <div class="http-tree-group">
              <span class="http-tree-folder">This task</span>
              <Show when={(adhoc() ?? []).length} fallback={<p class="http-empty">Nothing yet — new requests you make here stay with this task until you file them.</p>}>
                <For each={adhoc()}>{(row) => <TreeRow row={row} active={current()?.id === row.id} onOpen={open} onCopy={startNew} onDelete={remove} />}</For>
              </Show>
            </div>
          </Show>

          <For each={groups()}>
            {(group) => (
              <div class="http-tree-group">
                <span class="http-tree-folder">{group.folder || 'Ungrouped'}</span>
                <For each={group.requests}>{(row) => <TreeRow row={row} active={current()?.id === row.id} onOpen={open} onCopy={startNew} onDelete={remove} />}</For>
              </div>
            )}
          </For>

          <Show when={saved.state === 'ready' && !(saved() ?? []).length && !props.taskId}>
            <p class="http-empty">No saved requests for this repo yet.</p>
          </Show>
        </nav>

        <button type="button" class="http-vars-link" classList={{ active: selection().kind === 'variables' }} onClick={() => setSelection({ kind: 'variables' })}>
          <Icon name="braces" /> Variables
        </button>
      </aside>

      <div class="http-main">
        <Show
          when={selection().kind !== 'variables'}
          fallback={<HttpVariables owner={props.owner} repo={props.repo} />}
        >
          <div class="http-urlbar">
            <Select
              class="http-method"
              width="narrow"
              value={draft().method}
              aria-label="Method"
              data-method={methodTone(draft().method)}
              onChange={(e) => patch({ method: e.currentTarget.value })}
            >
              <For each={httpMethods}>{(m) => <option value={m}>{m}</option>}</For>
            </Select>
            <Input
              class="http-url"
              value={draft().url}
              placeholder="{{BASE_URL}}/users  ·  or paste a curl command"
              spellcheck={false}
              aria-label="URL"
              onInput={(e) => patch({ url: e.currentTarget.value })}
              onPaste={onUrlPaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void fire()
              }}
            />
            <Button variant="solid" tone="accent" busy={sending()} onClick={() => void fire()}>
              Send
            </Button>
          </div>

          <div class="http-metabar">
            <Input
              class="http-name"
              size="sm"
              value={draft().name}
              aria-label="Request name"
              placeholder="Request name"
              onInput={(e) => patch({ name: e.currentTarget.value })}
            />
            <Show when={!props.taskId || draft().taskId === null}>
              <Input
                class="http-folder"
                size="sm"
                value={draft().folder}
                aria-label="Folder"
                placeholder="Folder (e.g. auth/admin)"
                onInput={(e) => patch({ folder: e.currentTarget.value })}
              />
            </Show>
            <Show when={props.taskId && draft().taskId !== null}>
              <Button size="sm" variant="ghost" title="Move this out of the task and into the repo's saved requests" onClick={() => patch({ taskId: null })}>
                Save to repo…
              </Button>
            </Show>
            <span class="http-metabar-spacer" />
            <Show when={dirty()}>
              <span class="http-dirty" title="Unsaved changes">
                ●
              </span>
            </Show>
            <Button size="sm" variant="ghost" onClick={() => void copyAsCurl()}>
              Copy as curl
            </Button>
            <Button size="sm" busy={saving()} onClick={() => void save()}>
              {current() ? 'Save' : 'Save as new'}
            </Button>
          </div>

          <RequestTabs draft={draft()} patch={patch} />
          <ResponseView result={result()} error={error()} sending={sending()} />
        </Show>
      </div>
    </div>
  )
}

function TreeRow(props: { row: HttpRequest; active: boolean; onOpen: (row: HttpRequest) => void; onCopy: (row: HttpRequest) => void; onDelete: (row: HttpRequest) => void }) {
  return (
    <div class="http-tree-row" classList={{ active: props.active }}>
      <button type="button" class="http-tree-open" onClick={() => props.onOpen(props.row)}>
        <span class="http-method-chip" data-method={methodTone(props.row.method)}>
          {props.row.method}
        </span>
        <span class="http-tree-name">{props.row.name}</span>
      </button>
      <span class="http-tree-actions">
        <Button variant="bare" size="sm" iconOnly title="Duplicate as a new request" aria-label="Duplicate" onClick={() => props.onCopy(props.row)}>
          <Icon name="copy" />
        </Button>
        <Button variant="bare" size="sm" iconOnly title="Delete" aria-label="Delete" onClick={() => props.onDelete(props.row)}>
          <Icon name="trash-2" />
        </Button>
      </span>
    </div>
  )
}
