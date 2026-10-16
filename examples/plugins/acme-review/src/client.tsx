import { mountTree, type AcornBridge, type TreeMount } from 'acorn-plugin-sdk'
import { Button, Inline, Stack, Table, TableCell, TableHead, TableRow, Text, solidTree } from 'acorn-plugin-sdk/remote'
import { For, Show, createResource, createSignal, onCleanup } from 'solid-js'

// `solidTree` hands each renderer the point's props plus `bridge` and `host`.
type Mounted<P> = P & { bridge: AcornBridge; host: TreeMount['host'] }
const API = '/v1/p/acme-review'

// #region pane
// The task pane, refreshed when the Node half sends on this plugin's own channel.
function ReviewPane(props: Mounted<{ taskId: string }>) {
  const [list, { refetch }] = createResource(
    () => props.taskId,
    (taskId) => props.bridge.api.get<{ files: string[] }>(`${API}/files?taskId=${encodeURIComponent(taskId)}`),
  )
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
// #endregion

// #region tool-card
// Replaces Agents' card for this plugin's own tool, `acme-review_files`.
function ToolCard(props: Mounted<{ tool: { title: string; status?: string; output?: string } }>) {
  const files = (): string[] | null => {
    try {
      return JSON.parse(props.tool.output ?? '').files
    } catch {
      return null
    }
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
// #endregion

// #region interrupt
// Beside the terminal's own controls. The owner runs `interrupt` only after a press in this tree.
function Interrupt(props: Mounted<{ session?: { id: string; running: boolean } }>) {
  const [refusal, setRefusal] = createSignal('')
  const press = async () => {
    const result = await props.host.invoke<{ ok: boolean; reason?: string }>('interrupt', {
      expectedSessionId: props.session?.id,
    })
    setRefusal(result.ok ? '' : (result.reason ?? 'refused'))
  }
  return (
    <Inline>
      <Button size="sm" disabled={!props.session?.running} onPress={press}>
        Interrupt
      </Button>
      <Show when={refusal()}>
        <Text emphasis="muted">{refusal()}</Text>
      </Show>
    </Inline>
  )
}
// #endregion

// #region csv
// One table for every CSV viewer, capped at 50 rows.
function CsvTable(props: { text: string }) {
  const rows = () =>
    props.text
      .trim()
      .split('\n')
      .slice(0, 50)
      .map((line) => line.split(','))
  return (
    <Table size="sm">
      <TableRow head>
        <For each={rows()[0]}>{(cell) => <TableHead>{cell}</TableHead>}</For>
      </TableRow>
      <For each={rows().slice(1)}>
        {(row) => (
          <TableRow>
            <For each={row}>{(cell) => <TableCell>{cell}</TableCell>}</For>
          </TableRow>
        )}
      </For>
    </Table>
  )
}

// The body of an artifact card or a sent attachment's tile. The bytes come from this plugin's own
// route, which asks Agents.
type Media = { kind: 'artifact' | 'attachment'; id: string }
function CsvMedia(props: Mounted<{ taskId: string; sessionId: string; media: Media }>) {
  const [csv] = createResource(
    () => ({ taskId: props.taskId, sessionId: props.sessionId, kind: props.media.kind, id: props.media.id }),
    (key) =>
      props.bridge.api
        .getBytes(`${API}/artifact?${new URLSearchParams(key)}`)
        .then(({ bytes }) => new TextDecoder().decode(bytes))
        .catch(() => null),
  )
  return (
    <Show when={csv()} fallback={<Text emphasis="muted">{csv.loading ? 'Loading…' : "Couldn't read this file."}</Text>}>
      {(text) => <CsvTable text={text()} />}
    </Show>
  )
}

// Editor's view of a `.csv` file. Editor keeps the source one toggle away.
function CsvFile(props: Mounted<{ path: string; text?: string }>) {
  return (
    <Show when={props.text} fallback={<Text emphasis="muted">{props.path}</Text>}>
      {(text) => <CsvTable text={text()} />}
    </Show>
  )
}
// #endregion

// #region docs-preview
// A link preview. A new URL is a props update, so the resource reads again.
function DocsPreview(props: Mounted<{ url: string }>) {
  const [page] = createResource(
    () => props.url,
    (url) =>
      props.bridge.api
        .get<{ title: string; summary: string }>(`${API}/docs?url=${encodeURIComponent(url)}`)
        .catch(() => null),
  )
  return (
    <Show when={page()} fallback={<Text emphasis="muted">No summary for this page.</Text>}>
      {(found) => (
        <Stack gap="inline">
          <Text emphasis="strong">{found().title}</Text>
          <Text wrap>{found().summary}</Text>
        </Stack>
      )}
    </Show>
  )
}
// #endregion

// #region issue-review
// Above Linear's issue detail, in the region Linear declared with `mounts`.
function IssueReview(props: Mounted<{ item?: string }>) {
  const [answer] = createResource(
    () => props.item,
    (item) => props.bridge.api.get<{ status: string }>(`${API}/issue?item=${encodeURIComponent(item)}`),
  )
  return <Text emphasis="muted">{answer()?.status ?? ''}</Text>
}
// #endregion

// #region checklist
// A ```review fence in Markdown: one line per file, drawn as a checklist.
function Checklist(props: Mounted<{ text: string }>) {
  const files = () =>
    props.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  return (
    <Stack gap="inline">
      <Text emphasis="strong">Review checklist</Text>
      <For each={files()}>{(path) => <Text>{path}</Text>}</For>
    </Stack>
  )
}
// #endregion

// #region entries
mountTree({
  pane: solidTree(ReviewPane),
  toolCard: solidTree(ToolCard),
  interrupt: solidTree(Interrupt),
  csvMedia: solidTree(CsvMedia),
  csvFile: solidTree(CsvFile),
  docsPreview: solidTree(DocsPreview),
  issueReview: solidTree(IssueReview),
  checklist: solidTree(Checklist),
})
// #endregion
