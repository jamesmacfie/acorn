/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Hallmark · genre: modern-minimal · macrostructure: Workbench · design-system: Acorn UI kit */
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import {
  Alert, Badge, Button, Card, CopyButton, DetailColumn, EmptyState, Facts, Heading, Inline,
  ListColumn, ListDetail, Markdown, Row, Section, SectionHeader, SegmentedControl, Stack, Text, Toolbar,
  ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type { FindingCandidateRevision, FindingBundle } from '../contract/review'
import type { FindingEvidence, FindingObservation, FindingOrigin } from '../contract/records'
import {
  evidenceLabel, findingBody, findingClaimLabel, findingHeadline, findingOriginLabel, findingTime, findingTimestamp,
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

const sourceCount = (candidate: FindingCandidateRevision): string => {
  const count = candidate.sourceObservationIds.length
  return `From ${count} finding${count === 1 ? '' : 's'}`
}

// A part of the detail. A `sub` heading, so it sits on the column's edge with the text under it; a
// group label padded itself a second time inside the padded column and started at 28.
function Part(props: { label: string; count?: number; children: JSX.Element }) {
  return (
    <Stack gap="row">
      <SectionHeader level="sub" count={props.count}>{props.label}</SectionHeader>
      {props.children}
    </Stack>
  )
}

function SourceButton(props: { bridge: AcornBridge; origin: FindingOrigin }) {
  return (
    <Show when={props.origin.kind === 'agent' || props.origin.kind === 'workflow'}>
      <Button
        size="sm"
        variant="ghost"
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

// The detail's bar: the title, what kind of finding it is, and where it came from. It heads the
// column the way the list header heads the list.
function FindingHeader(props: { bridge: AcornBridge; finding: FindingObservation }) {
  return (
    <Toolbar ariaLabel="Finding">
      <Heading level={2}>{findingHeadline(props.finding).title}</Heading>
      <Badge tone={claimTone(props.finding)}>{findingClaimLabel(props.finding.claimStatus)}</Badge>
      <Badge>{props.finding.kind.label}</Badge>
      <Show when={!props.finding.kind.available}><Badge tone="warn">Type unavailable</Badge></Show>
      <Show when={props.finding.withdrawal}><Badge tone="neutral">Withdrawn</Badge></Show>
      <ToolbarSpacer />
      <SourceButton bridge={props.bridge} origin={props.finding.origin} />
    </Toolbar>
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
      <Facts
        grouping="rows"
        size="sm"
        items={[
          { label: 'Captured', value: findingTimestamp(props.finding.createdAt) },
          { label: 'Source', value: findingOriginLabel(props.finding.origin) },
          { label: 'Type', value: `${props.finding.kind.label} · v${props.finding.kind.version}` },
        ]}
      />

      <Show when={linkedCandidates().length}>
        <Part label="Ready for review" count={linkedCandidates().length}>
          <Stack gap="row">
            <For each={linkedCandidates()}>{(candidate) => (
              <Card pad="sm" stripe="ok">
                <Inline spread wrap>
                  <Stack gap="row">
                    <Text emphasis="strong">{candidateLabel(candidate)}</Text>
                    <Text tone="muted">{sourceCount(candidate)}</Text>
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
        </Part>
      </Show>

      <Part label="Details">
        <Show when={body().repaired}>
          <Alert tone="muted" variant="banner" title="Formatting repaired">
            acorn tidied broken lines in this older record. Open the agent run to see the original.
          </Alert>
        </Show>
        <Markdown
          text={body().markdown}
          images="placeholder"
          copy
          onCopy={(text: string) => void props.bridge.ui.copy(text)}
        />
      </Part>

      <Show when={props.finding.evidence.length}>
        <Part label="Evidence" count={props.finding.evidence.length}>
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
        </Part>
      </Show>

      <Show when={props.finding.withdrawal}>{(withdrawal) => (
        <Alert tone="muted" variant="banner" title="Withdrawn">
          {withdrawal().reason ?? 'No reason given'}
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

  // A Stack, so the rows keep their height in the column's flex box instead of shrinking into each
  // other.
  const findingList = () => (
    <Stack gap="none">
      <Show when={findings().length} fallback={(
        <EmptyState busy={page.loading} align="start" size="sm" title={view() === 'active' ? 'No active findings' : 'No findings yet'}>
          {view() === 'active' ? 'Withdrawn ones are under All.' : 'Agents record findings here as they work.'}
        </EmptyState>
      )}>
        <For each={findings()}>{(finding) => {
          const headline = createMemo(() => findingHeadline(finding))
          return (
            <Row
              density="roomy"
              variant="stacked"
              selected={selected()?.id === finding.id}
              onPress={() => setSelectedId(finding.id)}
              meta={findingTime(finding.createdAt)}
              tip={findingTimestamp(finding.createdAt)}
              tipAt={finding.createdAt}
              trailing={<Badge tone={finding.withdrawal ? 'neutral' : claimTone(finding)}>{finding.withdrawal ? 'Withdrawn' : findingClaimLabel(finding.claimStatus)}</Badge>}
            >
              <Text emphasis="strong">{headline().title}</Text>
              <Show when={headline().excerpt}><Text wrap tone="muted">{headline().excerpt}</Text></Show>
            </Row>
          )
        }}</For>
        <Show when={nextCursor()}>
          <Button label="Load older findings" busy={page.loading} onPress={() => void loadOlder()} />
        </Show>
      </Show>
    </Stack>
  )

  return (
    <ListDetail split listWidth="default">
      {/* `scroll`, because these are plain rows rather than a `Rows` collection, so nothing else
          scrolls them: nineteen findings ran off the bottom of the pane with no way to reach them. */}
      <ListColumn label="Findings" scroll>
        <SectionHeader
          count={findings().length}
          actions={
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
          }
        >
          Findings
        </SectionHeader>

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
                <Text tone="muted">{sourceCount(candidate)}</Text>
              </Row>
            )}</For>
          </Section>
        </Show>

        {/* The list's own label only when a second section stands beside it; alone, the header
            already names it. */}
        <Show when={candidates().length} fallback={findingList()}>
          <Section label="Findings" count={findings().length}>{findingList()}</Section>
        </Show>
      </ListColumn>

      <DetailColumn scroll>
        {/* The bar first, so it sits on the column's top edge. */}
        <Show when={selected()}>{(finding) => <FindingHeader bridge={props.bridge} finding={finding()} />}</Show>
        <Show when={error() ?? (page.error ? String(page.error) : null)}>{(detail) => (
          <Alert tone="danger" variant="banner" title="Couldn't load findings">{detail()}</Alert>
        )}</Show>
        <Show when={selected()} fallback={(
          <EmptyState busy={page.loading} title="Select a finding">
            Its details and where it came from show here.
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
