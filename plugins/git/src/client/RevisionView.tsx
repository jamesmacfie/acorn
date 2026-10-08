import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { activeNodeId, nodeReady } from '@acorn/plugin-api/client'
import { Alert, Badge, Button, CopyButton, DiffPane, EmptyState, Facts, Fold, ListColumn, ListDetail, Row, Rows, SectionHeader, Select, Stack, Text } from '@acorn/plugin-api/ui'
import type { DiffSource } from '@acorn/plugin-api/ui/diff'
import type { RevisionDetail } from '../shared/api'
import { revisionOptions } from './historyClient'
import { revisionSource } from './revisionSource'

export function RevisionView(props: { projectId: string; taskId?: string; id: string | null; onCommit: (id: string) => void }) {
  const [base, setBase] = createSignal<string | null | undefined>(undefined)
  const [file, setFile] = createSignal('')
  const scope = createMemo(() => JSON.stringify([activeNodeId(), props.projectId, props.taskId, props.id]))
  createEffect(on(scope, () => { setBase(undefined); setFile('') }, { defer: true }))
  const detail = createQuery(() => revisionOptions(props.projectId, props.id ?? '', base()))
  const current = createMemo(() => {
    const response = detail.data
    const nodeId = activeNodeId()
    if (!nodeId || !nodeReady() || !props.id || !response || response.nodeId !== nodeId ||
      response.projectId !== props.projectId || response.id !== props.id || response.requestedBase !== base()) return null
    return { detail: response.detail, target: { nodeId, projectId: props.projectId, taskId: props.taskId, id: props.id, base: response.detail.base } }
  })
  const [state, setState] = createSignal<{ detail: RevisionDetail; source: DiffSource } | null>(null)
  createEffect(() => {
    const selected = current()
    if (!selected) { setState(null); return }
    const controller = new AbortController()
    setState({ detail: selected.detail, source: revisionSource(selected.target, selected.detail, file,
      () => { if (!controller.signal.aborted) void detail.refetch() }, controller.signal) })
    onCleanup(() => controller.abort())
  })
  return <>
    <Show when={props.id}>
      <Show when={!nodeReady()}><EmptyState title="Node unavailable">Reconnect to inspect this revision.</EmptyState></Show>
      <Show when={detail.isLoading}><EmptyState title="Loading revision topology" /></Show>
      <Show when={detail.error}><Alert tone="warn">{String(detail.error)}</Alert></Show>
      <Show when={state()}>{(resolved) => {
        const revision = () => resolved().detail
        return <ListDetail list={<ListColumn scroll><Stack gap="section">
        <SectionHeader actions={<CopyButton text={() => revision().commit.id} always title="Copy full commit ID" />}>Revision · {revision().commit.id.slice(0, 12)}</SectionHeader>
        <Text>{revision().commit.message}</Text>
        <Fold label="Commit details"><Stack gap="row">
          <Facts grouping="rows" items={[
            { label: 'Author', value: `${revision().commit.author.name} <${revision().commit.author.email}> · ${new Date(revision().commit.author.at).toLocaleString()}` },
            { label: 'Committer', value: `${revision().commit.committer.name} <${revision().commit.committer.email}> · ${new Date(revision().commit.committer.at).toLocaleString()}` },
            { label: 'Object ID', value: revision().commit.id, mono: true },
            { label: 'Comparison', value: revision().base ?? 'Empty tree', mono: true },
          ]} />
          <Show when={revision().commit.refs.length}><For each={revision().commit.refs}>{(ref) => <Badge>{ref}</Badge>}</For></Show>
        </Stack></Fold>
        <Show when={revision().commit.parents.length} fallback={<Text emphasis="muted">Root commit · compared with the empty tree</Text>}>
          <SectionHeader>Parents</SectionHeader>
          <For each={revision().commit.parents}>{(parent, index) => <Button variant="ghost" onPress={() => props.onCommit(parent)}>
            Parent {index() + 1} · {parent.slice(0, 12)}
          </Button>}</For>
          <Select label="Compare with parent" value={revision().base ?? ''} options={revision().commit.parents.map((parent, index) => ({ value: parent, label: `Parent ${index + 1} · ${parent.slice(0, 12)}` }))}
            onChange={setBase} />
        </Show>
        <Show when={revision().omitted}><Alert tone="warn">{revision().omitted}</Alert></Show>
        <Fold label="Changed files" count={revision().files.length} defaultOpen={revision().files.length <= 5}>
            <Rows id={`git-files:${activeNodeId()}:${props.projectId}:${props.id}:${revision().base}`} ariaLabel="Changed files"
              items={revision().files.map((entry) => ({ key: entry.path, label: entry.path }))} selected={file() || null}
              onSelect={setFile} onActivate={setFile}>
              {(item, itemProps, selected) => {
                const entry = () => revision().files.find((row) => row.path === item.key)!
                return <Row item={itemProps} selected={selected()} onPress={() => setFile(item.key)}>
                  <Text>{entry().status} · {entry().oldPath ? `${entry().oldPath} → ` : ''}{entry().path}</Text>
                  <Show when={entry().oldMode !== '000000' && entry().newMode !== '000000' && entry().oldMode !== entry().newMode}><Badge>Mode {entry().oldMode} → {entry().newMode}</Badge></Show>
                  <Show when={entry().omission}><Text emphasis="muted">{entry().omission}</Text></Show>
                </Row>
              }}
            </Rows>
        </Fold>
      </Stack></ListColumn>}><DiffPane source={resolved().source} /></ListDetail>
      }}</Show>
    </Show>
  </>
}
