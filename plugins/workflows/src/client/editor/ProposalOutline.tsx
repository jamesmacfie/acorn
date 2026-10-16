import { createMemo, For, Show } from 'solid-js'
import { semanticAuthoringDiff } from '@acorn/protocol/authoring.ts'
import { Badge, Row, Stack, Text } from '@acorn/plugin-api/ui'
import type { WorkflowCatalog, WorkflowDef, WorkflowStepDef } from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS, readStepField } from '../../shared/stepFields'
import { stepIdentity } from '../../shared/workflowIdentity'
import { graphOrder } from './graphOrder'
import { stepSummary } from './outlineModel'

// An AI proposal drawn as the workflow it would leave, in the outline's own words, rather than as a
// list of JSON changes. Each step says whether it is new or changed, and the steps it drops follow.

/** What the proposal does to the draft: renamed or changed definition fields, each proposed step's
 *  status, and the names of the steps it removes. */
function proposalChanges(base: WorkflowDef, candidate: WorkflowDef) {
  const before = new Map(base.steps.map((step) => [stepIdentity(step), step]))
  const kept = new Set(candidate.steps.map(stepIdentity))
  const fields = [...new Set([...Object.keys(base), ...Object.keys(candidate)])]
    .filter((key) => key !== 'steps')
    .filter((key) => semanticAuthoringDiff(base[key as keyof WorkflowDef], candidate[key as keyof WorkflowDef]).length)
    .map((key) => (key === 'name' ? `Renames the workflow to "${candidate.name}".` : `Changes the workflow's ${key}.`))
  const status = new Map(
    candidate.steps.map((step) => {
      const old = before.get(stepIdentity(step))
      return [stepIdentity(step), !old ? 'New' : semanticAuthoringDiff(old, step).length ? 'Changed' : undefined]
    }),
  )
  const removed = base.steps.filter((step) => !kept.has(stepIdentity(step))).map((step) => step.name)
  return { fields, status, removed }
}

/** The step's first filled text field, such as an agent's prompt or a command, so the review shows
 *  what the step will actually do. */
const stepText = (step: WorkflowStepDef, catalog: WorkflowCatalog | undefined): string | undefined => {
  const kind = step.kind ?? 'agent'
  const fields = (catalog?.kinds.find((entry) => entry.id === kind)?.describe ?? BUILTIN_STEP_DESCRIPTIONS[kind])
    ?.fields
  for (const field of fields ?? []) {
    if (!['text', 'textarea', 'prompt'].includes(field.type)) continue
    const value = readStepField(step as Parameters<typeof readStepField>[0], kind, field.id)
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

export default function ProposalOutline(props: {
  base: WorkflowDef
  candidate: WorkflowDef
  catalog: WorkflowCatalog | undefined
}) {
  const changes = createMemo(() => proposalChanges(props.base, props.candidate))
  const stepFor = (name: string) => props.candidate.steps.find((step) => stepIdentity(step) === name)!
  return (
    <Stack gap="none">
      <For each={changes().fields}>{(line) => <Text wrap>{line}</Text>}</For>
      <For each={graphOrder(props.candidate)}>
        {(row) => (
          <Row
            density="compact"
            variant="stacked"
            depth={row.depth}
            meta={<Show when={changes().status.get(row.name)}>{(word) => <Badge size="xs">{word()}</Badge>}</Show>}
          >
            <Stack gap="none">
              <Text>{stepFor(row.name).name}</Text>
              <Text emphasis="muted">
                {stepText(stepFor(row.name), props.catalog) ??
                  stepSummary(stepFor(row.name), props.candidate, props.catalog)}
              </Text>
            </Stack>
          </Row>
        )}
      </For>
      <For each={changes().removed}>
        {(name) => (
          <Row density="compact" meta={<Badge size="xs">Removed</Badge>}>
            <Text>{name}</Text>
          </Row>
        )}
      </For>
    </Stack>
  )
}
