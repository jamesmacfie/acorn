import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { Alert, Badge, Button, Card, DetailColumn, EmptyState, Heading, Inline, Markdown, Section, Stack, Text } from '@acorn/plugin-api/ui/tree'
import type { FindingBundle } from '../contract/review'
import type { FindingEvidence, FindingObservation, FindingOrigin } from '../contract/records'
import { findingsTreeClient } from './findingsClient'

const originLabel = (origin: FindingOrigin): string => {
  switch (origin.kind) {
    case 'agent': return `Agent session ${origin.sessionId}`
    case 'workflow': return `Workflow run ${origin.runId}`
    case 'schedule': return `Schedule ${origin.scheduleId}`
    case 'device': return `Device ${origin.deviceId}`
    case 'plugin': return `Plugin ${origin.pluginId}`
    case 'legacy': return `Legacy proposal ${origin.proposalId}`
  }
}

const evidenceLabel = (evidence: FindingEvidence): string => evidence.label ?? (
  evidence.kind === 'repository' ? evidence.path
    : evidence.kind === 'url' ? evidence.url
      : evidence.kind === 'managed-turn' ? `Turn ${evidence.turnId}`
        : evidence.kind === 'workflow-step' ? `Workflow run ${evidence.runId}`
          : evidence.kind === 'observation' ? `Observation ${evidence.observationId}`
            : `Memory ${evidence.memoryId}`
)

const readyCandidates = (bundles: readonly FindingBundle[]) => bundles
  .filter((bundle) => bundle.state === 'ready')
  .flatMap((bundle) => bundle.candidates.filter((candidate) => candidate.status === 'ready'))

export function FindingsPane(props: { taskId?: string; bridge: AcornBridge }) {
  const api = findingsTreeClient(props.bridge)
  const [older, setOlder] = createSignal<FindingObservation[]>([])
  const [nextCursor, setNextCursor] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [page, { refetch }] = createResource(() => props.taskId, async (taskId) => {
    const result = await api.listTask(taskId, { state: 'history', limit: 50 })
    setNextCursor(result.nextCursor)
    return result
  })
  const [bundles, { refetch: refetchBundles }] = createResource(() => props.taskId, (taskId) => api.bundles(taskId))

  onMount(() => {
    const offObservations = props.bridge.events.on('plugin:findings:observations-changed', (payload) => {
      const frame = payload as { scope?: { kind?: unknown; taskId?: unknown } }
      if (frame.scope?.kind === 'task' && frame.scope.taskId === props.taskId) {
        setOlder([])
        void refetch()
      }
    })
    const offReview = props.bridge.events.on('plugin:findings:review-changed', () => void refetchBundles())
    onCleanup(() => { offReview(); offObservations() })
  })

  const loadOlder = async () => {
    if (!props.taskId || !nextCursor()) return
    try {
      const next = await api.listTask(props.taskId, { state: 'history', limit: 50, cursor: nextCursor()! })
      setOlder((current) => [...current, ...next.items])
      setNextCursor(next.nextCursor)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const findings = () => [...(page()?.items ?? []), ...older()]
  const candidates = () => readyCandidates(bundles() ?? [])

  return (
    <DetailColumn scroll>
      <Stack gap="section">
        <Stack gap="row">
          <Heading level={2}>Findings</Heading>
          <Text tone="muted" wrap>Quiet observations captured while work happens. Recording alone creates no notification or review obligation.</Text>
        </Stack>
        <Show when={error() ?? (page.error ? String(page.error) : null)}>{(detail) => <Alert tone="danger" title="Could not load findings">{detail()}</Alert>}</Show>
        <Show when={candidates().length}>
          <Section label="Ready for review" count={candidates().length}>
            <Stack gap="row">
              <For each={candidates()}>{(candidate) => (
                <Card>
                  <Inline wrap>
                    <Text weight="strong">{candidate.targetKind}</Text>
                    <Badge>{candidate.sourceObservationIds.length} source{candidate.sourceObservationIds.length === 1 ? '' : 's'}</Badge>
                    <Button label="Review in Memory" size="sm" onPress={() => void props.bridge.ui.openDestination('memory-review', candidate.candidateId)} />
                  </Inline>
                </Card>
              )}</For>
            </Stack>
          </Section>
        </Show>
        <Show when={findings().length} fallback={<EmptyState busy={page.loading} title="No findings yet">Task-scoped observations will appear here when a tool or producer records them.</EmptyState>}>
          <Stack gap="row">
            <For each={findings()}>{(finding) => (
              <Card disabled={!!finding.withdrawal}>
                <Stack gap="row">
                  <Inline wrap>
                    <Heading level={3}>{finding.title}</Heading>
                    <Badge tone={finding.claimStatus === 'observed' ? 'ok' : finding.claimStatus === 'inferred' ? 'warn' : 'neutral'}>{finding.claimStatus}</Badge>
                    <Badge>{finding.kind.label} v{finding.kind.version}</Badge>
                    <Show when={!finding.kind.available}><Badge tone="warn">kind unavailable</Badge></Show>
                    <Show when={finding.withdrawal}><Badge tone="neutral">withdrawn</Badge></Show>
                  </Inline>
                  <Markdown text={finding.body} images="placeholder" copy />
                  <Text tone="muted" wrap>{originLabel(finding.origin)}</Text>
                  <Show when={finding.evidence.length}>
                    <Section label="Evidence" count={finding.evidence.length}>
                      <Stack gap="row"><For each={finding.evidence}>{(evidence) => <Text wrap>{evidenceLabel(evidence)}</Text>}</For></Stack>
                    </Section>
                  </Show>
                  <Show when={finding.withdrawal}>{(withdrawal) => <Alert tone="muted" title="Withdrawn observation">{withdrawal().reason ?? 'No reason supplied'}</Alert>}</Show>
                </Stack>
              </Card>
            )}</For>
            <Show when={nextCursor()}><Button label="Load older findings" busy={page.loading} onPress={() => void loadOlder()} /></Show>
          </Stack>
        </Show>
      </Stack>
    </DetailColumn>
  )
}
