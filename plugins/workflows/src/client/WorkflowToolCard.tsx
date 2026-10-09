// The transcript card for the workflow agent tools (docs/agent-tools/workflow-tools.md § Presentation).
// It reads the Node's answer and opens the target the Node resolved; it never decides scope itself.
import { useNavigate } from '@solidjs/router'
import { createMemo, Show } from 'solid-js'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { openPane } from '@acorn/plugin-api/client'
import { Button, Card, CodeBlock, Inline, Stack, Text } from '@acorn/plugin-api/ui'
import { WORKFLOWS_PANE_ID } from './runs/runPaneModel'
import { workflowsSurfacePath } from './surfacePath'

type Answer = {
  revision?: number
  created?: boolean
  problems?: string[]
  diff?: { steps?: { added?: string[]; removed?: string[]; changed?: unknown[] } }
  status?: string
  name?: string
  target?: { kind?: string; resourceId?: string; projectId?: string; taskId?: string }
}

// Providers return plain JSON or the MCP content envelope around it.
function answer(text: string | undefined): Answer | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const content = (parsed as { content?: unknown }).content
    if (Array.isArray(content)) {
      for (const part of content) {
        const nested = answer((part as { text?: string })?.text)
        if (nested) return nested
      }
    }
    return parsed as Answer
  } catch {
    // A pending or failed call can carry plain text.
    return null
  }
}

const count = (items: readonly unknown[] | undefined, word: string): string | null =>
  items?.length ? `${items.length} ${word}` : null

const RUN_STATUS: Record<string, string> = {
  'awaiting-caller': 'starts when this turn ends', running: 'running', gated: 'waiting for a person', cancelling: 'cancelling',
  done: 'done', 'completed-with-failures': 'done with failures', failed: 'failed', 'safety-rail': 'stopped by a safety rail',
  cancelled: 'cancelled', 'not-started': "didn't start",
}

const RUN_VERB: Record<string, string> = {
  workflow_run: 'Started a workflow run', workflow_read: 'Read a workflow run',
  workflow_wait: 'Waited on a workflow run', workflow_cancel: 'Cancelled a workflow run',
}

export function WorkflowToolCard(props: AgentToolCardProps) {
  const navigate = useNavigate()
  const result = createMemo(() => props.tool.status === 'completed' ? answer(props.tool.output) : null)
  const target = () => result()?.target
  const isRun = () => props.tool.name !== 'workflow_draft'

  const draftSummary = () => {
    const steps = result()?.diff?.steps
    const problems = result()?.problems?.length
    return [
      count(steps?.added, 'added'), count(steps?.changed, 'changed'), count(steps?.removed, 'removed'),
      problems ? `${problems} ${problems === 1 ? 'problem' : 'problems'} to fix` : null,
    ].filter(Boolean).join(' · ')
  }
  const label = () => {
    const saved = result()
    if (props.tool.status === 'failed') return isRun() ? "The workflow tool call didn't succeed" : "Couldn't save the workflow draft"
    if (!saved) return isRun() ? 'Working with a workflow run' : 'Saving a workflow draft'
    if (isRun()) return `${RUN_VERB[props.tool.name ?? ''] ?? 'Workflow run'}${saved.name ? `: ${saved.name}` : ''}`
    return saved.created ? 'Saved a new workflow draft' : `Saved workflow draft revision ${saved.revision}`
  }
  const open = () => {
    const where = target()
    if (where?.kind === 'workflow-definition' && where.resourceId && where.projectId) navigate(workflowsSurfacePath(where.projectId, where.resourceId))
    if (where?.kind === 'workflow-run' && where.resourceId) openPane(where.taskId ?? props.taskId, WORKFLOWS_PANE_ID, { kind: 'workflows:show-run', runId: where.resourceId })
  }
  return (
    <Card>
      <Stack gap="row">
        <Text emphasis="strong">{label()}</Text>
        <Show when={!isRun() && draftSummary()}>{(text) => <Text emphasis="muted">Steps: {text()}</Text>}</Show>
        <Show when={isRun() && result()?.status}>{(status) => <Text emphasis="muted">The run {RUN_STATUS[status()] ?? status()}.</Text>}</Show>
        <Show
          when={target()?.resourceId}
          fallback={<Show when={props.tool.output && !result()}><CodeBlock wrap maxHeight="block">{props.tool.output}</CodeBlock></Show>}
        >
          <Inline>
            <Button size="sm" onPress={open}>{isRun() ? 'Open run' : 'Open workflow'}</Button>
            <Show when={!isRun()}><Text emphasis="muted">It won't run until you publish it.</Text></Show>
          </Inline>
        </Show>
      </Stack>
    </Card>
  )
}
