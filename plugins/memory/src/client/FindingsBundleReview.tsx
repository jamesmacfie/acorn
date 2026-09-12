import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import { onPluginFrame } from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { Alert, Badge, Button, Card, CodeBlock, Field, Heading, Inline, Input, Markdown, Section, Select, Stack, Text, Textarea, Toolbar } from '@acorn/plugin-api/ui'
import type { FindingCandidateRevision, FindingBundle } from '@acorn/plugin-findings/contract/review.ts'
import type { FindingScope } from '@acorn/plugin-findings/contract/records.ts'
import { memoryApi, type MemoryType } from './memoryClient'
import { type MemoryChangePayload, memoryChangePayloadSchema } from '../contract/findingsReview'

const TYPES: MemoryType[] = ['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user']
const key = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const payloadOf = (candidate: FindingCandidateRevision): MemoryChangePayload | null => {
  const parsed = memoryChangePayloadSchema.safeParse(candidate.payload); return parsed.success ? parsed.data : null
}
const scopeLabel = (payload: MemoryChangePayload): string => payload.scope.kind === 'private' ? 'Applies across projects' : 'Applies to this project'
const previewLines = (payload: MemoryChangePayload): string[] => [
  `name: ${payload.name}`,
  `type: ${payload.type}`,
  `scope: ${scopeLabel(payload)}`,
  `description: ${payload.description}`,
  '',
  ...payload.body.split('\n'),
]
const unifiedDiff = (before: MemoryChangePayload, after: MemoryChangePayload): string => {
  const left = previewLines(before), right = previewLines(after)
  if (left.join('\n') === right.join('\n')) return 'No text changes.'
  return ['--- accepted memory', '+++ proposed memory', ...left.map((line) => `- ${line}`), ...right.map((line) => `+ ${line}`)].join('\n')
}

function Candidate(props: { bundleId: string; candidate: FindingCandidateRevision; focused: boolean; onOpen(): void; onChanged(): void }) {
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
  return (
    <Card focus={props.focused} selected={props.focused}>
      <Stack gap="row">
        <Show when={initial()} fallback={<Alert tone="danger" title="Invalid memory candidate">This candidate cannot be previewed.</Alert>}>
          {(payload) => <>
            <Inline wrap><Badge shape="pill">{payload().operation === 'update' ? 'Update' : 'Add'}</Badge><Text emphasis="strong">{payload().name}</Text><Badge>{scopeLabel(payload())}</Badge><Show when={props.candidate.status !== 'ready'}><Badge tone="neutral">{props.candidate.status}</Badge></Show></Inline>
            <Text>{payload().description}</Text>
            <Show when={!props.focused}><Button size="sm" onPress={props.onOpen}>View change</Button></Show>
            <Show when={props.focused}>
              <Stack gap="row">
                <Text tone="muted" wrap>{props.candidate.groupingExplanation} · {props.candidate.sourceObservationIds.length} source occurrence{props.candidate.sourceObservationIds.length === 1 ? '' : 's'}</Text>
                <For each={props.candidate.warnings}>{(warning) => <Alert tone="warn">{warning}</Alert>}</For>
                <Show when={props.candidate.base}>{(base) => <Section label="Update diff"><CodeBlock>{unifiedDiff(base().payload as MemoryChangePayload, draft() ?? payload())}</CodeBlock></Section>}</Show>
                <Show when={!editing()} fallback={
                  <Stack gap="row">
                    <Field label="Name"><Input disabled={payload().operation === 'update'} value={draft()?.name ?? ''} onInput={(name) => setDraft((value) => value && ({ ...value, name }))} /></Field>
                    <Field label="Type"><Select value={draft()?.type ?? 'reference'} options={TYPES.map((type) => ({ value: type, label: type }))} onChange={(type) => setDraft((value) => value && ({ ...value, type: type as MemoryType }))} /></Field>
                    <Field label="Description"><Input value={draft()?.description ?? ''} onInput={(description) => setDraft((value) => value && ({ ...value, description }))} /></Field>
                    <Field label="Body"><Textarea mono rows={10} value={draft()?.body ?? ''} onInput={(body) => setDraft((value) => value && ({ ...value, body }))} /></Field>
                    <Field label="Scope"><Select value={draft()?.scope.kind ?? 'project'} options={[{ value: 'project', label: 'This project' }, { value: 'private', label: 'Across projects' }]} onChange={(scope) => setDraft((value) => value && ({ ...value, scope: scope === 'private' ? { kind: 'private' } : payload().scope.kind === 'project' ? payload().scope : { kind: 'project' } }))} /></Field>
                    <Toolbar variant="actions" size="sm"><Button size="sm" busy={busy()} onPress={save}>Save changes</Button><Button size="sm" onPress={() => { setDraft(payload()); setEditing(false) }}>Cancel</Button></Toolbar>
                  </Stack>
                }>
                  <Heading level={3}>{payload().name}</Heading><Text>{payload().type} · {scopeLabel(payload())}</Text><Text>{payload().description}</Text><Markdown text={payload().body} images="placeholder" copy />
                  <Show when={props.candidate.status === 'ready' && !recentlyDismissed()} fallback={<Show when={props.candidate.status === 'dismissed'}><Button size="sm" busy={busy()} onPress={undoHistory}>Undo dismissal</Button></Show>}>
                    <Toolbar variant="actions" size="sm"><Button size="sm" busy={busy()} onPress={approve}>{props.candidate.revision > 1 ? 'Approve changes' : 'Approve'}</Button><Button size="sm" disabled={busy()} onPress={() => setEditing(true)}>Edit</Button><Button size="sm" disabled={busy()} onPress={dismiss}>Dismiss</Button><Button size="sm" disabled={busy()} onPress={() => setSnoozing(true)}>Snooze</Button></Toolbar>
                    <Show when={snoozing()}><Inline wrap><Field label="Snooze until"><Input type="date" value={snoozeDate()} onInput={setSnoozeDate} /></Field><Button size="sm" busy={busy()} onPress={snooze}>Snooze until date</Button><Button size="sm" variant="bare" onPress={() => setSnoozing(false)}>Cancel snooze</Button></Inline></Show>
                  </Show>
                  <Show when={props.candidate.status === 'conflict'}><Button size="sm" disabled={busy()} onPress={() => setEditing(true)}>Edit conflicted change</Button></Show>
                  <Show when={props.candidate.status === 'applying'}><Button size="sm" busy={busy()} onPress={approve}>Retry approval</Button></Show>
                </Show>
                <Show when={detail()?.observations?.length}><Section label="Source observations" count={detail()!.observations.length}><Stack gap="row"><For each={detail()!.observations}>{(observation) => <Card><Inline wrap><Badge>{observation.claimStatus}</Badge><Text emphasis="strong">{observation.title}</Text><Show when={props.candidate.sourceObservationIds.length > 1}><Button size="sm" variant="bare" onPress={() => split(observation.id)}>Separate</Button></Show></Inline><Markdown text={observation.body} images="placeholder" /></Card>}</For></Stack></Section></Show>
                <Show when={history()?.items.length}><Section label="Review history"><Stack gap="row"><For each={history()!.items}>{(entry) => <Text tone="muted">{entry.action}{entry.reason ? ` · ${entry.reason}` : ''}</Text>}</For></Stack></Section></Show>
              </Stack>
            </Show>
          </>}
        </Show>
        <Show when={recentlyDismissed()}><Alert tone="muted" title="Suggestion dismissed"><Inline wrap><Button size="sm" onPress={undo}>Undo</Button><Button size="sm" variant="bare" onPress={() => dismissalReason('task-specific')}>Task-specific</Button><Button size="sm" variant="bare" onPress={() => dismissalReason('already-covered')}>Already covered</Button><Button size="sm" variant="bare" onPress={() => dismissalReason('not-useful')}>Not useful</Button></Inline></Alert></Show>
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
  const restore = (bundle: FindingBundle, observationId: string) => {
    const candidate = bundle.candidates.find((entry) => entry.candidateId === focused())
    if (!candidate) return
    setGroupingError('')
    void memoryApi().restoreFindingObservation(bundle.id, observationId, candidate.candidateId, candidate.revision, key()).then(changed).catch((error) => setGroupingError(error instanceof Error ? error.message : String(error)))
  }
  return <Show when={(bundles() ?? []).length}>
    <Stack gap="row"><Inline wrap><Heading level={2}>Suggested memory changes</Heading><Badge>{candidates().length}</Badge><Button size="sm" variant="bare" onPress={() => setShowHistory(!showHistory())}>{showHistory() ? 'Active suggestions' : 'History'}</Button></Inline>
      <For each={(bundles() ?? []).filter((bundle) => bundle.state === 'failed')}>{(bundle) => <Alert tone="danger" title="Could not prepare suggestions">{bundle.error ?? 'Preparation failed.'}<Button size="sm" onPress={() => retry(bundle)}>Retry</Button></Alert>}</For>
      <For each={(bundles() ?? []).filter((bundle) => bundle.state === 'preparing')}>{(bundle) => <Alert tone="muted" title="Preparing suggestions">{bundle.pendingCount} observations remain.<Button size="sm" onPress={() => void memoryApi().cancelPreparation(bundle.id).then(changed)}>Cancel</Button></Alert>}</For>
      <For each={(bundles() ?? []).filter((bundle) => bundle.state === 'cancelled' && bundle.pendingCount > 0)}>{(bundle) => <Alert tone="muted" title="Preparation cancelled">Completed suggestions were kept. {bundle.pendingCount} observations remain.<Button size="sm" onPress={() => retry(bundle)}>Resume</Button></Alert>}</For>
      <For each={shown()}>{(candidate) => {
        const bundle = (bundles() ?? []).find((entry) => entry.candidates.some((member) => member.candidateId === candidate.candidateId))!
        return <Candidate bundleId={bundle.id} candidate={candidate} focused={focused() === candidate.candidateId} onOpen={() => setFocused(candidate.candidateId)} onChanged={changed} />
      }}</For>
      <For each={(bundles() ?? []).filter((bundle) => bundle.outcomes.some((outcome) => outcome.outcome === 'not-selected'))}>{(bundle) => <Section label="Omitted observations"><Stack gap="row"><For each={bundle.outcomes.filter((outcome) => outcome.outcome === 'not-selected')}>{(outcome) => <Card><Text>{outcome.explanation}</Text><Text tone="muted">Observation {outcome.observationId}</Text><Show when={bundle.candidates.some((candidate) => candidate.candidateId === focused())}><Button size="sm" variant="bare" onPress={() => restore(bundle, outcome.observationId)}>Restore to open change</Button></Show></Card>}</For></Stack></Section>}</For>
      <Show when={candidates().length > 3 && !showAll()}><Button size="sm" onPress={() => setShowAll(true)}>Show all {candidates().length} changes</Button></Show>
      <Show when={!candidates().length}><Text>No suggested changes left in this bundle.</Text></Show>
      <Show when={groupingError()}><Alert tone="danger">{groupingError()}</Alert></Show>
    </Stack>
  </Show>
}
