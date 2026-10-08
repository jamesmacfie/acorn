import { createEffect, createSignal, For, Show } from 'solid-js'
import { clientEvents, readJson, writeJson } from '@acorn/plugin-api/client'
import { Alert, Button, CodeBlock, Fold, Link, Select, Stack, Text } from '@acorn/plugin-api/ui'

type Task = { id: string; title: string; projectId: string }
type Finding = { file: string; line: number; category: string; detail: string }
type Change = { path: string; status: string; patch: string | null; beforeCanonical: string | null; afterCanonical: string | null }
type Review = { id: string; taskId: string; projectId: string; digest: string; scope: string; baseline: boolean; findings: Finding[]; changes: Change[]; limits: string }
const route = '/v1/p/agents/instruction-review'

export default function InstructionReviewPanel(props: { nodeId?: string | null }) {
  const [tasks, setTasks] = createSignal<Task[]>([])
  const [taskId, setTaskId] = createSignal('')
  const [review, setReview] = createSignal<Review | null>(null)
  const [reviewNodeId, setReviewNodeId] = createSignal<string | undefined>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [approved, setApproved] = createSignal(false)
  let generation = 0
  const nodeId = () => props.nodeId ?? undefined
  const selectedProject = () => tasks().find((task) => task.id === taskId())?.projectId

  createEffect(() => {
    const selectedNode = nodeId()
    const currentGeneration = ++generation
    setTasks([])
    setReview(null)
    setReviewNodeId(undefined)
    setTaskId('')
    setApproved(false)
    setBusy(false)
    setError('')
    void readJson<Task[]>(`${route}/tasks`, { nodeId: selectedNode }).then((found) => {
      if (generation !== currentGeneration) return
      setTasks(found)
      setTaskId(found[0]?.id ?? '')
    }).catch(() => { if (generation === currentGeneration) setError("Couldn't load projects for instruction review.") })
  })

  const load = async () => {
    const selectedNode = nodeId()
    const selectedTask = taskId()
    const currentGeneration = generation
    if (!selectedTask) return
    setBusy(true); setError(''); setApproved(false); setReview(null)
    try {
      const result = await readJson<Review>(`${route}?taskId=${encodeURIComponent(selectedTask)}`, { nodeId: selectedNode })
      if (generation === currentGeneration && taskId() === selectedTask) { setReview(result); setReviewNodeId(selectedNode) }
    } catch (cause) { if (generation === currentGeneration) setError(cause instanceof Error ? cause.message : 'Instruction scan incomplete. Retry the review.') }
    finally { if (generation === currentGeneration) setBusy(false) }
  }
  const approve = async () => {
    const current = review()
    if (!current || nodeId() !== reviewNodeId() || taskId() !== current.taskId) return
    const selectedNode = nodeId()
    const currentGeneration = generation
    setBusy(true); setError('')
    try {
      await writeJson(`${route}/${encodeURIComponent(current.id)}/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: current.taskId }), nodeId: selectedNode,
      }, (response) => `Instruction approval ${response.status}`)
      if (generation === currentGeneration) { setApproved(true); setReview(null) }
    } catch (cause) { if (generation === currentGeneration) setError(cause instanceof Error ? cause.message : 'Instructions changed. Open a new review.') }
    finally { if (generation === currentGeneration) setBusy(false) }
  }

  return <Stack gap="row">
    <Text emphasis="muted" wrap>Review is per project and Node. Findings are advisory; read the changed files before approving if you need more context. Plugin skills and executable project configuration have separate approvals.</Text>
    <Text emphasis="muted" wrap>Other controls: <Link onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'plugins' })}>Installed plugins and skills</Link>
      <Show when={selectedProject()}>{(projectId) => <> and <Link onPress={() => clientEvents.emit('presentation:open-settings', { tab: `project/${projectId()}` })}>Project configuration</Link></>}</Show>
    </Text>
    <Show when={tasks().length} fallback={<Text emphasis="muted">No active project tasks are available for review.</Text>}>
      <Select label="Project task" value={taskId()} options={tasks().map((task) => ({ value: task.id, label: task.title }))}
        onChange={(value) => { setTaskId(value); setReview(null); setApproved(false) }} />
      <Button size="sm" busy={busy()} onPress={() => void load()}>Review instruction files</Button>
    </Show>
    <Show when={error()}><Alert>{error()}</Alert></Show>
    <Show when={approved()}><Text>Instruction snapshot approved. A later change requires another review.</Text></Show>
    <Show when={review()}>{(result) => <Stack gap="row">
      <Text wrap>{result().baseline ? 'First use: review this baseline.' : 'Changes since the last approved snapshot.'} {result().changes.length} {result().changes.length === 1 ? 'file' : 'files'} and {result().findings.length} {result().findings.length === 1 ? 'finding' : 'findings'}.</Text>
      <Text emphasis="muted" wrap>Scope: {result().scope}</Text>
      <Text emphasis="muted" wrap>{result().limits}</Text>
      <For each={result().findings}>{(finding) =>
        <Text wrap>{finding.category}: {finding.file}{finding.line ? `:${finding.line}` : ''} — {finding.detail}</Text>}
      </For>
      <For each={result().changes}>{(change) =>
        <Fold label={`${change.status}: ${change.path}`} defaultOpen={false}>
          <Show when={change.status === 'retargeted'}><Text wrap>Link target: {change.beforeCanonical} → {change.afterCanonical}</Text></Show>
          <Show when={change.patch} fallback={<Text>Unsupported file format; text diff unavailable.</Text>}>
            <CodeBlock wrap maxHeight="block">{change.patch}</CodeBlock>
          </Show>
        </Fold>}
      </For>
      <Button busy={busy()} onPress={() => void approve()}>Approve this snapshot</Button>
    </Stack>}</Show>
  </Stack>
}
