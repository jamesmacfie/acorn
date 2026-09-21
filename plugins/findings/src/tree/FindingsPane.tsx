/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Hallmark · genre: modern-minimal · macrostructure: Workbench · design-system: Acorn UI kit */
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import {
  Alert, Badge, Button, Card, CopyButton, DetailColumn, EmptyState, Facts, Heading, Inline,
  ListColumn, ListDetail, Markdown, Row, Section, SegmentedControl, Stack, Text, Toolbar,
  ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type { FindingCandidateRevision, FindingBundle } from '../contract/review'
import type { FindingEvidence, FindingObservation, FindingOrigin } from '../contract/records'
import {
  evidenceLabel, findingBody, findingClaimLabel, findingExcerpt, findingOriginLabel, findingTimestamp,
} from './findingPresentation'
import { findingsTreeClient } from './findingsClient'

type FindingView = 'active' | 'history'

const readyCandidates = (bundles: readonly FindingBundle[]) => bundles
  .filter((bundle) => bundle.state === 'ready')
  .flatMap((bundle) => bundle.candidates.filter((candidate) => candidate.status === 'ready'))

const claimTone = (finding: FindingObservation): 'ok' | 'warn' | 'neutral' =>
  finding.claimStatus === 'observed' ? 'ok' : finding.claimStatus === 'inferred' ? 'warn' : 'neutral'

const candidateLabel = (candidate: FindingCandidateRevision): string =>
  candidate.targetKind === 'memory:change' ? 'Memory suggestion' : 'Review suggestion'

function SourceButton(props: { bridge: AcornBridge; origin: FindingOrigin }) {
  return (
    <Show when={props.origin.kind === 'agent' || props.origin.kind === 'workflow'}>
      <Button
        size="sm"
        label={props.origin.kind === 'agent' ? 'Open agent run' : 'Open workflow run'}
        onPress={() => {
          const origin = props.origin
          if (origin.kind === 'agent') void props.bridge.ui.openDestination('agent-run', origin.sessionId)
          if (origin.kind === 'workflow') {
            void props.bridge.ui.openDestination('workflow-run', origin.runId, origin.stepId)
          }
        }}
      />
    </Show>
  )
}

function EvidenceRow(props: {
  bridge: AcornBridge
  evidence: FindingEvidence
  observationAvailable: boolean
  onObservation: () => void
}) {
  const action = () => {
    switch (props.evidence.kind) {
      case 'managed-turn': {
        const evidence = props.evidence
        return <Button size="sm" label="Open agent run" onPress={() => void props.bridge.ui.openDestination('agent-run', evidence.sessionId)} />
      }
      case 'workflow-step': {
        const evidence = props.evidence
        return <Button size="sm" label="Open workflow run" onPress={() => void props.bridge.ui.openDestination('workflow-run', evidence.runId, evidence.stepId)} />
      }
      case 'url':
        return <Button size="sm" label="Open link" href={props.evidence.url} />
      case 'repository':
        return <CopyButton always text={props.evidence.path} onCopy={(text: string) => void props.bridge.ui.copy(text)} title="Copy path" />
      case 'observation':
        return props.observationAvailable
          ? <Button size="sm" label="View finding" onPress={props.onObservation} />
          : <CopyButton always text={props.evidence.observationId} onCopy={(text: string) => void props.bridge.ui.copy(text)} title="Copy finding ID" />
      case 'memory-version':
        return <CopyButton always text={props.evidence.memoryId} onCopy={(text: string) => void props.bridge.ui.copy(text)} title="Copy memory ID" />
    }
  }

  return (
    <Row
      density="compact"
      variant="stacked"
      trailing={action()}
      onPress={props.evidence.kind === 'observation' && props.observationAvailable ? props.onObservation : undefined}
    >
      <Text wrap>{evidenceLabel(props.evidence)}</Text>
      <Text emphasis="mono" tone="muted">{props.evidence.kind}</Text>
    </Row>
  )
}

function FindingDetail(props: {
  bridge: AcornBridge
  finding: FindingObservation
  findings: readonly FindingObservation[]
  candidates: readonly FindingCandidateRevision[]
  onFinding: (id: string) => void
}) {
  const body = createMemo(() => findingBody(props.finding))
  const linkedCandidates = createMemo(() => props.candidates
    .filter((candidate) => candidate.sourceObservationIds.includes(props.finding.id)))

  return (
    <Stack gap="section">
      <Inline spread wrap>
        <Stack gap="row">
          <Heading level={2}>{props.finding.title}</Heading>
          <Inline wrap>
            <Badge tone={claimTone(props.finding)}>{findingClaimLabel(props.finding.claimStatus)}</Badge>
            <Badge>{props.finding.kind.label}</Badge>
            <Show when={!props.finding.kind.available}><Badge tone="warn">Type unavailable</Badge></Show>
            <Show when={props.finding.withdrawal}><Badge tone="neutral">Withdrawn</Badge></Show>
          </Inline>
        </Stack>
        <SourceButton bridge={props.bridge} origin={props.finding.origin} />
      </Inline>

      <Facts
        grouping="rows"
        size="sm"
        items={[
          { label: 'Captured', value: findingTimestamp(props.finding.createdAt) },
          { label: 'Source', value: findingOriginLabel(props.finding.origin) },
          { label: 'Type', value: `${props.finding.kind.label} · v${props.finding.kind.version}` },
          { label: 'Source key', value: props.finding.sourceKey, mono: true },
        ]}
      />

      <Show when={linkedCandidates().length}>
        <Section label="Ready for review" count={linkedCandidates().length}>
          <Stack gap="row">
            <For each={linkedCandidates()}>{(candidate) => (
              <Card pad="sm" stripe="ok">
                <Inline spread wrap>
                  <Stack gap="row">
                    <Text emphasis="strong">{candidateLabel(candidate)}</Text>
                    <Text tone="muted">Built from {candidate.sourceObservationIds.length} finding{candidate.sourceObservationIds.length === 1 ? '' : 's'}</Text>
                  </Stack>
                  <Button
                    label="Review in Memory"
                    size="sm"
                    onPress={() => void props.bridge.ui.openDestination('memory-review', candidate.candidateId)}
                  />
                </Inline>
              </Card>
            )}</For>
          </Stack>
        </Section>
      </Show>

      <Section label="Observation">
        <Show when={body().repaired}>
          <Alert tone="muted" variant="banner" title="Formatting repaired">
            This older record was captured from streamed text. Acorn compacted the broken line fragments for readability; open the source run for the original transcript.
          </Alert>
        </Show>
        <Markdown
          text={body().markdown}
          images="placeholder"
          copy
          onCopy={(text: string) => void props.bridge.ui.copy(text)}
        />
      </Section>

      <Show when={props.finding.evidence.length}>
        <Section label="Evidence" count={props.finding.evidence.length}>
          <Stack gap="row">
            <For each={props.finding.evidence}>{(evidence) => {
              const relatedId = evidence.kind === 'observation' ? evidence.observationId : ''
              const available = () => props.findings.some((finding) => finding.id === relatedId)
              return (
                <EvidenceRow
                  bridge={props.bridge}
                  evidence={evidence}
                  observationAvailable={available()}
                  onObservation={() => props.onFinding(relatedId)}
                />
              )
            }}</For>
          </Stack>
        </Section>
      </Show>

      <Show when={props.finding.withdrawal}>{(withdrawal) => (
        <Alert tone="muted" variant="banner" title="Withdrawn observation">
          {withdrawal().reason ?? 'No reason supplied'}
        </Alert>
      )}</Show>
    </Stack>
  )
}

export function FindingsPane(props: { taskId?: string; bridge: AcornBridge }) {
  const api = findingsTreeClient(props.bridge)
  const [view, setView] = createSignal<FindingView>('active')
  const [selectedId, setSelectedId] = createSignal<string>()
  const [older, setOlder] = createSignal<FindingObservation[]>([])
  const [nextCursor, setNextCursor] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [page, { refetch }] = createResource(
    () => props.taskId ? { taskId: props.taskId, state: view() } : undefined,
    async ({ taskId, state }) => {
      const result = await api.listTask(taskId, { state, limit: 50 })
      setNextCursor(result.nextCursor)
      return result
    },
  )
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
      const next = await api.listTask(props.taskId, { state: view(), limit: 50, cursor: nextCursor()! })
      setOlder((current) => [...current, ...next.items])
      setNextCursor(next.nextCursor)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const findings = createMemo(() => [...(page()?.items ?? []), ...older()])
  const candidates = createMemo(() => readyCandidates(bundles() ?? []))
  const selected = createMemo(() => findings().find((finding) => finding.id === selectedId()) ?? findings()[0])
  const changeView = (next: FindingView) => {
    setOlder([])
    setNextCursor(null)
    setError(null)
    setView(next)
  }

  return (
    <ListDetail split listWidth="default">
      <ListColumn label="Findings">
        <Toolbar ariaLabel="Finding filters">
          <Text emphasis="strong">Findings</Text>
          <ToolbarSpacer />
          <SegmentedControl
            size="sm"
            ariaLabel="Finding history"
            value={view()}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'history', label: 'All' },
            ]}
            onChange={changeView}
          />
        </Toolbar>

        <Show when={candidates().length}>
          <Section label="Ready in Memory" count={candidates().length}>
            <For each={candidates()}>{(candidate) => (
              <Row
                density="compact"
                variant="stacked"
                onPress={() => void props.bridge.ui.openDestination('memory-review', candidate.candidateId)}
                trailing={<Badge tone="ok">Ready</Badge>}
              >
                <Text emphasis="strong">{candidateLabel(candidate)}</Text>
                <Text tone="muted">{candidate.sourceObservationIds.length} source{candidate.sourceObservationIds.length === 1 ? '' : 's'}</Text>
              </Row>
            )}</For>
          </Section>
        </Show>

        <Section label="Observations" count={findings().length}>
          <Show when={findings().length} fallback={(
            <EmptyState busy={page.loading} align="start" size="sm" title={view() === 'active' ? 'No active findings' : 'No findings yet'}>
              {view() === 'active'
                ? 'Withdrawn observations remain available under All.'
                : 'Task observations appear here when an agent or producer records them.'}
            </EmptyState>
          )}>
            <For each={findings()}>{(finding) => (
              <Row
                density="roomy"
                variant="stacked"
                selected={selected()?.id === finding.id}
                onPress={() => setSelectedId(finding.id)}
                meta={findingTimestamp(finding.createdAt)}
                trailing={<Badge tone={finding.withdrawal ? 'neutral' : claimTone(finding)}>{finding.withdrawal ? 'Withdrawn' : findingClaimLabel(finding.claimStatus)}</Badge>}
              >
                <Text emphasis="strong">{finding.title}</Text>
                <Text wrap tone="muted">{findingExcerpt(finding)}</Text>
              </Row>
            )}</For>
            <Show when={nextCursor()}>
              <Button label="Load older findings" busy={page.loading} onPress={() => void loadOlder()} />
            </Show>
          </Show>
        </Section>
      </ListColumn>

      <DetailColumn scroll>
        <Show when={error() ?? (page.error ? String(page.error) : null)}>{(detail) => (
          <Alert tone="danger" variant="banner" title="Could not load findings">{detail()}</Alert>
        )}</Show>
        <Show when={selected()} fallback={(
          <EmptyState busy={page.loading} title="Select a finding">
            Choose an observation to read its detail and provenance.
          </EmptyState>
        )}>
          {(finding) => (
            <FindingDetail
              bridge={props.bridge}
              finding={finding()}
              findings={findings()}
              candidates={candidates()}
              onFinding={setSelectedId}
            />
          )}
        </Show>
      </DetailColumn>
    </ListDetail>
  )
}
