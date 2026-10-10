# The extension example's trees

This page is the client bundle of [the extension example](./extension-example.md): seven tree
renderers in one file, built with Vite into `dist/client.js`. It's part of
[plugin authoring](../plugin-authoring.md).

## `src/client.tsx`

```tsx
import { mountTree, type AcornBridge, type TreeMount } from 'acorn-plugin-sdk'
import { Button, Inline, Stack, Table, TableCell, TableHead, TableRow, Text, solidTree } from 'acorn-plugin-sdk/remote'
import { For, Show, createResource, createSignal, onCleanup } from 'solid-js'

// `solidTree` hands each renderer the point's props plus `bridge` and `host`.
type Mounted<P> = P & { bridge: AcornBridge; host: TreeMount['host'] }
const API = '/v1/p/acme-review'

// The task pane, refreshed when the Node half sends on this plugin's own channel.
function ReviewPane(props: Mounted<{ taskId: string }>) {
  const [list, { refetch }] = createResource(() => props.taskId, (taskId) =>
    props.bridge.api.get<{ files: string[] }>(`${API}/files?taskId=${encodeURIComponent(taskId)}`))
  onCleanup(props.bridge.events.on('plugin:acme-review:changed', () => void refetch()))
  return (
    <Stack gap="section">
      <Text emphasis="strong">Files under review</Text>
      <Show when={list()?.files.length} fallback={<Text emphasis="muted">Use Add to review on a file.</Text>}>
        <For each={list()?.files}>{(path) => <Text>{path}</Text>}</For>
      </Show>
    </Stack>
  )
}

// Replaces Agents' card for this plugin's own tool, `acme-review_files`.
function ToolCard(props: Mounted<{ tool: { title: string; status?: string; output?: string } }>) {
  const files = (): string[] | null => {
    try { return JSON.parse(props.tool.output ?? '').files } catch { return null }
  }
  return (
    <Stack gap="inline">
      <Text emphasis="strong">{props.tool.title}</Text>
      <Show when={files()} fallback={<Text emphasis="muted">{props.tool.status ?? 'running'}</Text>}>
        <For each={files()}>{(path) => <Text>{path}</Text>}</For>
      </Show>
    </Stack>
  )
}

// Beside the terminal's own controls. The owner runs `interrupt` only after a press in this tree.
function Interrupt(props: Mounted<{ session?: { id: string; running: boolean } }>) {
  const [refusal, setRefusal] = createSignal('')
  const press = async () => {
    const result = await props.host.invoke<{ ok: boolean; reason?: string }>('interrupt', {
      expectedSessionId: props.session?.id,
    })
    setRefusal(result.ok ? '' : result.reason ?? 'refused')
  }
  return (
    <Inline>
      <Button size="sm" disabled={!props.session?.running} onPress={press}>Interrupt</Button>
      <Show when={refusal()}><Text emphasis="muted">{refusal()}</Text></Show>
    </Inline>
  )
}

// One table for both CSV viewers, capped at 50 rows.
function CsvTable(props: { text: string }) {
  const rows = () => props.text.trim().split('\n').slice(0, 50).map((line) => line.split(','))
  return (
    <Table size="sm">
      <TableRow head><For each={rows()[0]}>{(cell) => <TableHead>{cell}</TableHead>}</For></TableRow>
      <For each={rows().slice(1)}>
        {(row) => <TableRow><For each={row}>{(cell) => <TableCell>{cell}</TableCell>}</For></TableRow>}
      </For>
    </Table>
  )
}

// An artifact card's body. The bytes come from this plugin's own route, which asks Agents.
function CsvArtifact(props: Mounted<{ taskId: string; sessionId: string; media: { id: string } }>) {
  const [csv] = createResource(
    () => ({ taskId: props.taskId, sessionId: props.sessionId, id: props.media.id }),
    async (key) => {
      const { bytes } = await props.bridge.api.getBytes(`${API}/artifact?${new URLSearchParams(key)}`)
      return new TextDecoder().decode(bytes)
    },
  )
  return <Show when={csv()} fallback={<Text emphasis="muted">Loading…</Text>}>{(text) => <CsvTable text={text()} />}</Show>
}

// Editor's view of a `.csv` file. Editor keeps the source one toggle away.
function CsvFile(props: Mounted<{ path: string; text?: string }>) {
  return <Show when={props.text} fallback={<Text emphasis="muted">{props.path}</Text>}>{(text) => <CsvTable text={text()} />}</Show>
}

// A link preview. A new URL is a props update, so the resource reads again.
function DocsPreview(props: Mounted<{ url: string }>) {
  const [page] = createResource(() => props.url, (url) =>
    props.bridge.api.get<{ title: string; summary: string }>(`${API}/docs?url=${encodeURIComponent(url)}`).catch(() => null))
  return (
    <Show when={page()} fallback={<Text emphasis="muted">No summary for this page.</Text>}>
      {(found) => <Stack gap="inline"><Text emphasis="strong">{found().title}</Text><Text wrap>{found().summary}</Text></Stack>}
    </Show>
  )
}

// Above Linear's issue detail, in the region Linear declared with `mounts`.
function IssueReview(props: Mounted<{ item?: string }>) {
  const [answer] = createResource(() => props.item, (item) =>
    props.bridge.api.get<{ status: string }>(`${API}/issue?item=${encodeURIComponent(item)}`))
  return <Text emphasis="muted">{answer()?.status ?? ''}</Text>
}

mountTree({
  pane: solidTree(ReviewPane),
  toolCard: solidTree(ToolCard),
  interrupt: solidTree(Interrupt),
  csvArtifact: solidTree(CsvArtifact),
  csvFile: solidTree(CsvFile),
  docsPreview: solidTree(DocsPreview),
  issueReview: solidTree(IssueReview),
})
```

## How the trees behave

The bundle runs in a worker with no DOM. Each `mountTree` key is an entry a manifest `remote` names,
and the host mounts one tree per visible slot. All of them share the worker and its bridge. A tree
gets the point's props as a store, so a change of props redraws in place instead of remounting
([drawing a tree](./the-client-half.md#drawing-a-tree)).

- **Reads go to your own routes.** `bridge.api` reaches `/v1/p/acme-review/` with no scope, and refuses
  another plugin's namespace. A resource keyed on the props reads again when they change and keeps
  only the latest answer. Draw a fallback while it loads and when it fails.
- **Props are the owner's facts.** The pane gets `{ taskId, projectId }`, a tool card gets `{ tool,
  taskId, defaultOpen, fileChanges? }`, and `editor:document` gets `{ taskId, path, text?, revision
  }`. `plugin_authoring` lists every point's props.
- **Actions are requests.** `host.invoke('interrupt', ...)` runs only if the point declares the action
  and the owner bound it to this slot. Terminal refuses it with `needs_person` unless a person pressed
  inside this tree, and with `changed` when the session moved on, so draw the refusal
  ([toolbar actions](../plugins/toolbar-actions.md)).
- **Trees are one level deep.** A tree can't open a slot for a third plugin, and a loaded owner gets
  host-drawn regions with `mounts` instead ([detail regions](../plugins/detail-regions.md)).
- **The owner keeps its controls.** Editor keeps **Source**, Agents keeps an artifact's name and
  **Download**, and Linear keeps its own detail. When a tree fails, a `replace` point draws the
  owner's default instead.

Disposal is the host's: unmounting a slot ends its tree and runs `onCleanup`, so the pane's event
listener goes with it. Disabling the plugin or switching Node unmounts its trees, and so does
leaving the view a tree sat in.
