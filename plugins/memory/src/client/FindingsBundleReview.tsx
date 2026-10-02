/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · component: candidate review card · genre: modern-minimal · theme: Acorn UI kit
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass (46–50)
 */
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import { onPluginFrame, pluginLabel } from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { Alert, Badge, Button, Card, Field, Heading, Inline, Input, Markdown, Section, SegmentedControl, Select, Stack, StackedDiff, Text, Textarea } from '@acorn/plugin-api/ui'
import type { FindingCandidateRevision, FindingBundle, FindingCandidateStatus } from '@acorn/plugin-findings/contract/review.ts'
import type { FindingEvidence, FindingObservation, FindingOrigin, FindingScope } from '@acorn/plugin-findings/contract/records.ts'
import { MEMORY_SCOPE_LABEL, MEMORY_SCOPE_OPTIONS, MEMORY_TYPE_LABEL, MEMORY_TYPE_OPTIONS, memoryApi, type MemoryType } from './memoryClient'
import { type MemoryChangePayload, memoryChangePayloadSchema } from '../contract/findingsReview'

const key = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const payloadOf = (candidate: FindingCandidateRevision): MemoryChangePayload | null => {
  const parsed = memoryChangePayloadSchema.safeParse(candidate.payload); return parsed.success ? parsed.data : null
}
const scopeLabel = (payload: MemoryChangePayload): string => MEMORY_SCOPE_LABEL[payload.scope.kind]
const typeLabel = (type: MemoryType): string => MEMORY_TYPE_LABEL[type] ?? type
// The words a person reads for a suggestion's state and for what was done to it, in place of the
// enum. A ready suggestion shows no badge, so it has no word.
const STATUS_LABEL: Partial<Record<FindingCandidateStatus, string>> = {
  draft: 'Draft', snoozed: 'Snoozed', dismissed: 'Dismissed', applying: 'Saving', applied: 'Saved', conflict: 'Needs a fix', superseded: 'Replaced',
}
const HISTORY_LABEL: Record<string, string> = {
  edit: 'Edited', dismiss: 'Dismissed', 'dismiss-reason': 'Dismissed', 'undo-dismiss': 'Restored', snooze: 'Snoozed',
  restore: 'Restored', split: 'Separated', applying: 'Saving', applied: 'Approved', conflict: 'Needed a fix',
}
const REASON_LABEL: Record<string, string> = { 'task-specific': 'Task-specific', 'already-covered': 'Already covered', 'not-useful': 'Not useful' }
const boundaryLabel = (key: string): string => key.startsWith('task:') ? 'Task archive'
  : key.startsWith('workflow:') ? 'Workflow completion'
    : key.startsWith('terminal:') ? 'Terminal completion'
      : key.startsWith('manual:') ? 'Manual review'
        : key.startsWith('legacy:') ? 'Legacy import' : 'Review'
const originLabel = (origin: FindingOrigin): string => origin.kind === 'agent' ? 'Agent'
  : origin.kind === 'workflow' ? 'Workflow'
    : origin.kind === 'schedule' ? 'Schedule'
      : origin.kind === 'device' ? 'This device'
        : origin.kind === 'plugin' ? pluginLabel(origin.pluginId) : 'Older suggestion'
// What the evidence is, in words; the id it points at goes in the tip, for anyone who needs it.
const evidenceLabel = (evidence: FindingEvidence): { text: string; tip?: string } => evidence.label ? { text: evidence.label }
  : evidence.kind === 'repository' ? { text: evidence.path }
    : evidence.kind === 'url' ? { text: evidence.url }
      : evidence.kind === 'managed-turn' ? { text: 'An agent turn', tip: evidence.turnId }
        : evidence.kind === 'workflow-step' ? { text: 'A workflow run', tip: evidence.runId }
          : evidence.kind === 'observation' ? { text: 'A finding', tip: evidence.observationId }
            : { text: 'A memory', tip: evidence.memoryId }
const previewLines = (payload: MemoryChangePayload): string[] => [
  `name: ${payload.name}`,
  `type: ${typeLabel(payload.type)}`,
  `scope: ${scopeLabel(payload)}`,
  `description: ${payload.description}`,
  '',
  ...payload.body.split('\n'),
]
/** The accepted memory against the suggestion, as one hunk for `StackedDiff`: the lines both share at
 *  the start and the end are context, and everything between them changed. Null when nothing did. */
export const memoryPatch = (before: MemoryChangePayload, after: MemoryChangePayload): string | null => {
  const left = previewLines(before), right = previewLines(after)
  if (left.join('\n') === right.join('\n')) return null
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  let end = 0
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++
  return [
    `@@ -1,${left.length} +1,${right.length} @@`,
    ...left.slice(0, start).map((line) => ` ${line}`),
    ...left.slice(start, left.length - end).map((line) => `-${line}`),
    ...right.slice(start, right.length - end).map((line) => `+${line}`),
    ...left.slice(left.length - end).map((line) => ` ${line}`),
  ].join('\n')
}

function ObservationSource(props: { observation: FindingObservation; canSplit: boolean; onSplit(): void }) {
  return (
    <Card>
      <Stack gap="row">
        <Inline wrap>
          <Badge>{props.observation.claimStatus === 'asked' ? 'Question' : props.observation.claimStatus === 'inferred' ? 'Inferred' : 'Observed'}</Badge>
          <Text emphasis="strong">{props.observation.title}</Text>
          <Show when={props.observation.scopeLabels.task}><Badge>{props.observation.scopeLabels.task}</Badge></Show>
          <Show when={props.canSplit}><Button size="sm" variant="bare" onPress={props.onSplit}>Separate</Button></Show>
        </Inline>
        <Text tone="muted">{originLabel(props.observation.origin)} · {new Date(props.observation.createdAt).toLocaleString()}</Text>
        <Markdown text={props.observation.body} images="placeholder" />
        <Show when={props.observation.evidence.length}>
          <Section label="Evidence" count={props.observation.evidence.length}>
            <Stack gap="row"><For each={props.observation.evidence}>{(evidence) => <Text tip={evidenceLabel(evidence).tip}>{evidenceLabel(evidence).text}</Text>}</For></Stack>
          </Section>
        </Show>
      </Stack>
    </Card>
  )
}

function CandidateActions(props: {
  candidate: FindingCandidateRevision
  busy: boolean
  dismissed: boolean
  showOpen: boolean
  onOpen(): void
  onApprove(): void
  onEdit(): void
  onDismiss(): void
  onSnooze(): void
  onUndoDismissal(): void
}) {
  // Approve is the one primary; the rest are ghost, so the row says which press moves things on.
  return (
    <Inline gap="row" wrap>
      <Show when={props.showOpen}><Button variant="ghost" onPress={props.onOpen}>View change</Button></Show>
      <Show when={props.candidate.status === 'ready' && !props.dismissed}>
        <Button variant="solid" busy={props.busy} onPress={props.onApprove}>{props.candidate.revision > 1 ? 'Approve changes' : 'Approve'}</Button>
        <Button variant="ghost" disabled={props.busy} onPress={props.onEdit}>Edit</Button>
        <Button variant="ghost" disabled={props.busy} onPress={props.onDismiss}>Dismiss</Button>
        <Button variant="ghost" disabled={props.busy} onPress={props.onSnooze}>Snooze</Button>
      </Show>
      <Show when={props.candidate.status === 'dismissed'}><Button busy={props.busy} onPress={props.onUndoDismissal}>Undo</Button></Show>
      <Show when={props.candidate.status === 'conflict'}><Button variant="solid" disabled={props.busy} onPress={props.onEdit}>Fix the conflict</Button></Show>
      <Show when={props.candidate.status === 'applying'}><Button variant="solid" busy={props.busy} onPress={props.onApprove}>Try again</Button></Show>
    </Inline>
  )
}

function Candidate(props: { bundleId: string; boundary: string; candidate: FindingCandidateRevision; focused: boolean; onOpen(): void; onChanged(): void }) {
  const initial = () => payloadOf(props.candidate)
  const [editing, setEditing] = createSignal(false), [busy, setBusy] = createSignal(false), [error, setError] = createSignal('')
  const [snoozing, setSnoozing] = createSignal(false), [snoozeDate, setSnoozeDate] = createSignal(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10))
  const [draft, setDraft] = createSignal<MemoryChangePayload | null>(initial())
  const [detail] = createResource(() => props.focused ? props.candidate.candidateId : null, (id) => memoryApi().finding(id!))
  const [history, { refetch: refetchHistory }] = createResource(() => props.focused ? props.candidate.candidateId : null, (id) => memoryApi().findingHistory(id!))
  const [recentlyDismissed, setRecentlyDismissed] = createSignal<FindingCandidateRevision | null>(null)
  const act = async (fn: () => Promise<unknown>, refresh = true) => { setBusy(true); setError(''); try { await fn(); if (props.focused) void refetchHistory(); if (refresh) props.onChanged() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  const save = () => { const value = draft(); if (!value) return; void act(async () => { await memoryApi().editFinding(props.candidate.candidateId, props.candidate.revision, value, key()); setEditing(false) }) }
  const approve = () => void act(async () => { const result = await memoryApi().approveFinding(props.candidate.candidateId, props.candidate.revision, props.candidate.payloadHash, key()); if (!result.ok) throw new Error(result.reason ?? 'Memory approval failed.') })
  const dismiss = () => void act(async () => { const result = await memoryApi().decideFinding(props.candidate.candidateId, { expectedRevision: props.candidate.revision, action: 'dismiss', idempotencyKey: key() }); setRecentlyDismissed(result) }, false)
  const dismissalReason = (reason: string) => { const candidate = recentlyDismissed(); if (!candidate) return; void act(() => memoryApi().decideFinding(candidate.candidateId, { expectedRevision: candidate.revision, action: 'dismiss-reason', reason, idempotencyKey: key() }), false) }
  const undo = () => { const candidate = recentlyDismissed(); if (!candidate) return; void act(async () => { await memoryApi().decideFinding(candidate.candidateId, { expectedRevision: candidate.revision, action: 'undo-dismiss', idempotencyKey: key() }); setRecentlyDismissed(null) }) }
  const snooze = () => { const until = new Date(`${snoozeDate()}T23:59:59`).getTime(); if (!Number.isFinite(until)) return; void act(() => memoryApi().decideFinding(props.candidate.candidateId, { expectedRevision: props.candidate.revision, action: 'snooze', until, idempotencyKey: key() })) }
  const undoHistory = () => void act(() => memoryApi().decideFinding(props.candidate.candidateId, { expectedRevision: props.candidate.revision, action: 'undo-dismiss', idempotencyKey: key() }))
  const split = (observationId: string) => void act(() => memoryApi().splitFinding(props.candidate.candidateId, props.bundleId, props.candidate.revision, [observationId], key()))
  const edit = () => { setEditing(true); props.onOpen() }
  const chooseSnooze = () => { setSnoozing(true); props.onOpen() }
  const actions = () => (
    <CandidateActions
      candidate={props.candidate}
      busy={busy()}
      dismissed={!!recentlyDismissed()}
      showOpen={!props.focused}
      onOpen={props.onOpen}
      onApprove={approve}
      onEdit={edit}
      onDismiss={dismiss}
      onSnooze={chooseSnooze}
      onUndoDismissal={undoHistory}
    />
  )
  return (
    <Card focus={props.focused} selected={props.focused}>
      <Stack gap="row">
        <Show when={initial()} fallback={<Alert tone="danger">Can't show this suggestion</Alert>}>
          {(payload) => <>
            <Inline wrap><Badge shape="pill">{payload().operation === 'update' ? 'Update' : 'Add'}</Badge><Text emphasis="strong">{payload().name}</Text><Badge>{scopeLabel(payload())}</Badge><Badge tone="neutral">{boundaryLabel(props.boundary)}</Badge><Show when={STATUS_LABEL[props.candidate.status]}>{(status) => <Badge tone={props.candidate.status === 'conflict' ? 'warn' : 'neutral'}>{status()}</Badge>}</Show></Inline>
            <Text>{payload().description}</Text>
            <Show when={!props.focused}>{actions()}</Show>
            <Show when={props.focused}>
              <Stack gap="row">
                <Text tone="muted" wrap>From {props.candidate.sourceObservationIds.length} finding{props.candidate.sourceObservationIds.length === 1 ? '' : 's'}. {props.candidate.groupingExplanation}</Text>
                <For each={props.candidate.warnings}>{(warning) => <Alert tone="warn">{warning}</Alert>}</For>
                <Show when={props.candidate.base}>{(base) => (
                  <Section label="What changes">
                    <Show when={memoryPatch(base().payload as MemoryChangePayload, draft() ?? payload())} fallback={<Text tone="muted">No text changes.</Text>}>
                      {(patch) => <StackedDiff path={`${payload().name}.md`} patch={patch()} lineNumbers={false} />}
                    </Show>
                  </Section>
                )}</Show>
                <Show when={!editing()} fallback={
                  <Stack gap="row">
                    <Field label="Name"><Input disabled={payload().operation === 'update'} value={draft()?.name ?? ''} onInput={(name) => setDraft((value) => value && ({ ...value, name }))} /></Field>
                    <Field label="Type"><Select value={draft()?.type ?? 'reference'} options={MEMORY_TYPE_OPTIONS} onChange={(type) => setDraft((value) => value && ({ ...value, type: type as MemoryType }))} /></Field>
                    <Field label="Description"><Input value={draft()?.description ?? ''} onInput={(description) => setDraft((value) => value && ({ ...value, description }))} /></Field>
                    <Field label="Body"><Textarea mono rows={10} value={draft()?.body ?? ''} onInput={(body) => setDraft((value) => value && ({ ...value, body }))} /></Field>
                    <Field label="Scope"><Select value={draft()?.scope.kind ?? 'project'} options={MEMORY_SCOPE_OPTIONS} onChange={(scope) => setDraft((value) => value && ({ ...value, scope: scope === 'private' ? { kind: 'private' } : payload().scope.kind === 'project' ? payload().scope : { kind: 'project' } }))} /></Field>
                    <Inline gap="row"><Button variant="solid" busy={busy()} onPress={save}>Save changes</Button><Button variant="ghost" onPress={() => { setDraft(payload()); setEditing(false) }}>Cancel</Button></Inline>
                  </Stack>
                }>
                  <Heading level={3}>{payload().name}</Heading><Text>{typeLabel(payload().type)} · {scopeLabel(payload())}</Text><Text>{payload().description}</Text><Markdown text={payload().body} images="placeholder" copy />
                  {actions()}
                  <Show when={props.candidate.status === 'ready' && !recentlyDismissed() && snoozing()}><Inline wrap><Field label="Snooze until"><Input type="date" value={snoozeDate()} onInput={setSnoozeDate} /></Field><Button busy={busy()} onPress={snooze}>Snooze</Button><Button variant="ghost" onPress={() => setSnoozing(false)}>Cancel</Button></Inline></Show>
                </Show>
                <Show when={detail()?.observations?.length}>
                  <Section label="Source tasks and evidence" count={detail()!.observations.length}>
                    <Stack gap="row"><For each={detail()!.observations}>{(observation) => (
                      <ObservationSource observation={observation} canSplit={props.candidate.sourceObservationIds.length > 1} onSplit={() => split(observation.id)} />
                    )}</For></Stack>
                  </Section>
                </Show>
                <Show when={history()?.items.length}><Section label="Review history"><Stack gap="row"><For each={history()!.items}>{(entry) => <Text tone="muted">{HISTORY_LABEL[entry.action] ?? entry.action}{entry.reason ? `: ${REASON_LABEL[entry.reason] ?? entry.reason}` : ''}</Text>}</For></Stack></Section></Show>
              </Stack>
            </Show>
          </>}
        </Show>
        <Show when={recentlyDismissed()}><Alert tone="muted" title="Suggestion dismissed" actions={<><Button onPress={undo}>Undo</Button><Button variant="ghost" onPress={() => dismissalReason('task-specific')}>Task-specific</Button><Button variant="ghost" onPress={() => dismissalReason('already-covered')}>Already covered</Button><Button variant="ghost" onPress={() => dismissalReason('not-useful')}>Not useful</Button></>}>Say why, if you like.</Alert></Show>
        <Show when={error()}><Alert tone="danger">{error()}</Alert></Show>
      </Stack>
    </Card>
  )
}

export default function FindingsBundleReview(props: { scope: FindingScope; compact?: boolean; focusCandidateId?: string; onChanged?: () => void }) {
  const [showHistory, setShowHistory] = createSignal(false)
  const [bundles, { refetch }] = createResource(() => `${JSON.stringify(props.scope)}:${showHistory()}`, () => memoryApi().bundles(props.scope, showHistory()))
  const [focused, setFocused] = createSignal<string | null>(props.focusCandidateId ?? null), [showAll, setShowAll] = createSignal(false)
  createEffect(() => { if (props.focusCandidateId) setFocused(props.focusCandidateId) })
  const [groupingError, setGroupingError] = createSignal('')
  onCleanup(onPluginFrame('findings', pluginChannel('findings', 'review-changed'), () => void refetch()))
  const candidates = createMemo(() => (bundles() ?? []).flatMap((bundle: FindingBundle) => bundle.candidates))
  const shown = createMemo(() => {
    if (showAll()) return candidates()
    const first = candidates().slice(0, 3), selected = candidates().find((candidate) => candidate.candidateId === focused())
    return selected && !first.includes(selected) ? [selected, ...first.slice(0, 2)] : first
  })
  const changed = () => { void refetch(); props.onChanged?.() }
  const retry = (bundle: FindingBundle) => void memoryApi().retryPreparation(bundle.id).then(changed)
  const dismissBundle = (bundle: FindingBundle) => void memoryApi().dismissBundle(bundle.id, key(), 'bundle-not-useful').then(changed)
  const restore = (bundle: FindingBundle, observationId: string) => {
    const candidate = bundle.candidates.find((entry) => entry.candidateId === focused())
    if (!candidate) return
    setGroupingError('')
    void memoryApi().restoreFindingObservation(bundle.id, observationId, candidate.candidateId, candidate.revision, key()).then(changed).catch((error) => setGroupingError(error instanceof Error ? error.message : String(error)))
  }
  return <Show when={(bundles() ?? []).length}>
    <Stack gap="row">
      <Inline spread wrap>
        <Inline gap="inline"><Heading level={2}>Suggested memory changes</Heading><Text emphasis="muted">{candidates().length}</Text></Inline>
        <SegmentedControl
          size="sm"
          ariaLabel="Suggestions to show"
          value={showHistory() ? 'history' : 'waiting'}
          options={[{ value: 'waiting', label: 'Waiting' }, { value: 'history', label: 'History' }]}
          onChange={(value) => setShowHistory(value === 'history')}
        />
      </Inline>
      <For each={(bundles() ?? []).filter((bundle) => bundle.state === 'failed')}>{(bundle) => <Alert tone="danger" title="Couldn't prepare suggestions" actions={<Button onPress={() => retry(bundle)}>Try again</Button>}>{bundle.error ?? 'Something went wrong while preparing them.'}</Alert>}</For>
      <For each={(bundles() ?? []).filter((bundle) => bundle.state === 'preparing')}>{(bundle) => <Alert tone="muted" title="Preparing suggestions" actions={<Button variant="ghost" onPress={() => void memoryApi().cancelPreparation(bundle.id).then(changed)}>Cancel</Button>}>{bundle.pendingCount} findings left to read.</Alert>}</For>
      <For each={(bundles() ?? []).filter((bundle) => bundle.state === 'cancelled' && bundle.pendingCount > 0)}>{(bundle) => <Alert tone="muted" title="Stopped" actions={<Button onPress={() => retry(bundle)}>Resume</Button>}>The suggestions so far are kept. {bundle.pendingCount} findings are left.</Alert>}</For>
      <For each={(bundles() ?? []).filter((bundle) => bundle.state === 'ready' && bundle.backendId === null && bundle.candidates.length > 3)}>{(bundle) => (
        <Alert tone="warn" title="Unfiltered suggestions" actions={<Button onPress={() => dismissBundle(bundle)}>Dismiss all of these</Button>}>
          These were made without a model, so there can be one per finding.
        </Alert>
      )}</For>
      <For each={shown()}>{(candidate) => {
        const bundle = (bundles() ?? []).find((entry) => entry.candidates.some((member) => member.candidateId === candidate.candidateId))!
        return <Candidate bundleId={bundle.id} boundary={bundle.boundaryKey} candidate={candidate} focused={focused() === candidate.candidateId} onOpen={() => setFocused(candidate.candidateId)} onChanged={changed} />
      }}</For>
      <For each={(bundles() ?? []).filter((bundle) => bundle.outcomes.some((outcome) => outcome.outcome === 'not-selected'))}>{(bundle) => <Section label="Findings left out"><Stack gap="row"><For each={bundle.outcomes.filter((outcome) => outcome.outcome === 'not-selected')}>{(outcome) => <Card><Text tip={outcome.observationId}>{outcome.explanation}</Text><Show when={bundle.candidates.some((candidate) => candidate.candidateId === focused())}><Button size="sm" variant="ghost" onPress={() => restore(bundle, outcome.observationId)}>Add back</Button></Show></Card>}</For></Stack></Section>}</For>
      <Show when={candidates().length > 3 && !showAll()}><Button size="sm" onPress={() => setShowAll(true)}>Show all {candidates().length} changes</Button></Show>
      <Show when={!candidates().length && (bundles() ?? []).some((bundle) => bundle.state === 'ready')}>
        <Text>Nothing to review. The last review found nothing worth keeping, or you've handled it all.</Text>
      </Show>
      <Show when={groupingError()}><Alert tone="danger">{groupingError()}</Alert></Show>
    </Stack>
  </Show>
}
