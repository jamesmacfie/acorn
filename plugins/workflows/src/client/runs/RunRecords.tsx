import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { formatRelativeTime, onPluginFrame, type Task } from '@acorn/plugin-api/client'
import {
  Alert, Badge, Button, CodeBlock, ConfirmButton, EmptyState, Facts, Fold, Heading, Icon, Inline,
  Row, Rows, SectionHeader, SegmentedControl, Stack, Text,
} from '@acorn/plugin-api/ui'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import type {
  WorkflowRecordAttempt,
  WorkflowRecordFilter,
  WorkflowRecordHistory,
  WorkflowRecordPage,
} from '../../shared/workflowProcessing'
import { workflowApi } from '../workflowsClient'
import { runGlyph, runTone } from './runDisplay'
import { progressSummary, RECORD_FILTERS, recordCanReprocess, recordCanRetry, recordStatus } from './recordHistoryModel'

type Detail = Awaited<ReturnType<typeof workflowApi.record>>

export function RunRecords(props: {
  runId: string
  stepId: string
  tasks: readonly Task[]
  initialRecordId?: string
  onOpen(taskId: string, runId?: string, record?: { rootRunId: string; recordId: string }): void
}) {
  const [filter, setFilter] = createSignal<WorkflowRecordFilter>('all')
  const [page, setPage] = createSignal<WorkflowRecordPage>()
  const [records, setRecords] = createSignal<WorkflowRecordHistory[]>([])
  const [selectedId, setSelectedId] = createSignal<string | null>(props.initialRecordId ?? null)
  const [detail, setDetail] = createSignal<Detail>(null)
  const [attempts, setAttempts] = createSignal<WorkflowRecordAttempt[]>([])
  const [attemptNext, setAttemptNext] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [prepared, setPrepared] = createSignal<{ recordId: string; digest: string; title: string } | null>(null)
  let generation = 0

  const selected = createMemo(() => records().find(row => row.id === selectedId()))
  const source = createMemo(() => page()?.provenance?.source)
  const sourceLabel = () => source() ? `${source()!.pluginId} · ${source()!.sourceId}` : 'Structured records'

  const readPage = async (append: boolean): Promise<void> => {
    const current = ++generation
    setBusy(true)
    setError('')
    try {
      let result = await workflowApi.records(props.runId, {
        stepId: props.stepId,
        selectionId: append ? page()?.selectionId ?? undefined : undefined,
        after: append ? page()?.next ?? undefined : undefined,
        limit: 100,
        filter: filter(),
      })
      if (current !== generation) return
      const loaded = [...result.records]
      // A return link may target any of the 500 retained rows. Walk bounded summary pages until that
      // row is present; record bodies and outputs still stay behind the selected-record request.
      while (!append && props.initialRecordId && !loaded.some(row => row.id === props.initialRecordId)
        && result.next !== null && result.selectionId && loaded.length < 500) {
        result = await workflowApi.records(props.runId, {
          stepId: props.stepId,
          selectionId: result.selectionId,
          after: result.next,
          limit: 100,
          filter: filter(),
        })
        if (current !== generation) return
        loaded.push(...result.records)
      }
      if (current !== generation) return
      const nextRecords = append ? [...records(), ...loaded] : loaded
      setPage(result)
      setRecords(nextRecords)
      setSelectedId(previous => {
        if (previous && nextRecords.some(row => row.id === previous)) return previous
        if (props.initialRecordId && nextRecords.some(row => row.id === props.initialRecordId)) return props.initialRecordId
        return nextRecords[0]?.id ?? null
      })
    } catch (caught) {
      if (current === generation) setError(caught instanceof Error ? caught.message : 'Record history could not be refreshed.')
    } finally {
      if (current === generation) setBusy(false)
    }
  }

  const refreshLoaded = async (): Promise<void> => {
    const current = ++generation
    const target = Math.max(100, records().length)
    setBusy(true)
    setError('')
    try {
      let cursor: number | undefined
      let selectionId: string | undefined
      let latest: WorkflowRecordPage | undefined
      const loaded: WorkflowRecordHistory[] = []
      do {
        latest = await workflowApi.records(props.runId, {
          stepId: props.stepId,
          selectionId,
          after: cursor,
          limit: Math.min(100, target - loaded.length),
          filter: filter(),
        })
        selectionId = latest.selectionId ?? undefined
        loaded.push(...latest.records)
        cursor = latest.next ?? undefined
      } while (cursor !== undefined && loaded.length < target)
      if (current !== generation || !latest) return
      setPage(latest)
      setRecords(loaded)
      setSelectedId(previous => previous && loaded.some(row => row.id === previous) ? previous : loaded[0]?.id ?? null)
    } catch (caught) {
      if (current === generation) setError(caught instanceof Error ? caught.message : 'Record history could not be refreshed.')
    } finally {
      if (current === generation) setBusy(false)
    }
  }

  createEffect(() => {
    filter()
    setRecords([])
    setPage(undefined)
    setDetail(null)
    setAttempts([])
    setPrepared(null)
    void readPage(false)
  })

  createEffect(() => {
    const row = selected()
    if (!row) { setDetail(null); setAttempts([]); setAttemptNext(null); setPrepared(null); return }
    const expected = row.id
    setDetail(null)
    setAttempts([])
    setAttemptNext(null)
    setPrepared(null)
    void Promise.all([
      workflowApi.record(props.runId, expected),
      workflowApi.recordAttempts(props.runId, expected),
    ]).then(([record, history]) => {
      if (selectedId() !== expected) return
      setDetail(record)
      setAttempts(history.attempts)
      setAttemptNext(history.next)
    }).catch(caught => {
      if (selectedId() === expected) setError(caught instanceof Error ? caught.message : 'Record detail could not be loaded.')
    })
  })

  const refresh = () => void refreshLoaded()
  onCleanup(onPluginFrame('workflows', pluginChannel('workflows', 'run-changed'), payload => {
    if ((payload as { runId?: string }).runId === props.runId) refresh()
  }))
  onCleanup(onPluginFrame('workflows', pluginChannel('workflows', 'child-changed'), payload => {
    if ((payload as { parentRunId?: string }).parentRunId === props.runId) refresh()
  }))

  const retry = async (row: WorkflowRecordHistory): Promise<void> => {
    if (!row.runId || !row.retryStepId) return
    setBusy(true)
    setError('')
    try { await workflowApi.retry(row.runId, row.retryStepId); refresh() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'This attempt could not be retried.') }
    finally { setBusy(false) }
  }

  const prepare = async (row: WorkflowRecordHistory): Promise<void> => {
    setBusy(true)
    setError('')
    try { setPrepared(await workflowApi.prepareReprocess(props.runId, row.id)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'This attempt could not be prepared for reprocessing.') }
    finally { setBusy(false) }
  }

  const reprocess = async (row: WorkflowRecordHistory): Promise<void> => {
    const review = prepared()
    if (!review || review.recordId !== row.id) return
    setBusy(true)
    setError('')
    try {
      const result = await workflowApi.reprocess(props.runId, row.id, review.digest, crypto.randomUUID())
      setPrepared(null)
      props.onOpen(result.taskId, result.runId, { rootRunId: props.runId, recordId: row.id })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This record could not be reprocessed.')
    } finally { setBusy(false) }
  }

  const loadAttempts = async (): Promise<void> => {
    const row = selected()
    const cursor = attemptNext()
    if (!row || !cursor) return
    setBusy(true)
    try {
      const history = await workflowApi.recordAttempts(props.runId, row.id, cursor)
      setAttempts(current => [...current, ...history.attempts])
      setAttemptNext(history.next)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Attempt history could not be loaded.') }
    finally { setBusy(false) }
  }

  return (
    <Stack gap="section">
      <Stack gap="row">
        <Inline wrap>
          <Heading level={3}>Record history</Heading>
          <Text emphasis="muted">{page() ? progressSummary(page()!.counts) : 'Loading records…'}</Text>
        </Inline>
        <Inline wrap>
          <SegmentedControl ariaLabel="Record filter" size="sm" value={filter()} options={[...RECORD_FILTERS]} onChange={setFilter} />
          <Text emphasis="muted">{sourceLabel()}</Text>
          <Show when={page()?.provenance?.completeness}>{value => <Badge size="xs">{value().kind}</Badge>}</Show>
        </Inline>
        <Show when={error()}>{message => <Alert tone="warn" title={records().length ? 'Showing the last loaded records' : undefined}>{message()}</Alert>}</Show>
      </Stack>

      <Show
        when={records().length}
        fallback={<EmptyState size="sm">{
          busy() ? 'Loading records…'
            : filter() !== 'all' ? 'No records match this filter.'
              : page()?.emptyReason === 'all-skipped' ? 'All matches were already processed.'
                : 'No records matched this run.'
        }</EmptyState>}
      >
        <Rows
          virtual
          id={`workflows:records:${props.runId}:${props.stepId}:${filter()}`}
          ariaLabel="Workflow records"
          items={records().map(row => ({ key: row.id, label: row.title }))}
          selected={selectedId()}
          onSelect={setSelectedId}
          onActivate={setSelectedId}
        >
          {(item, itemProps, isSelected) => {
            const row = () => records().find(candidate => candidate.id === item.key)!
            const task = () => row().taskId ? props.tasks.find(candidate => candidate.id === row().taskId) : undefined
            return (
              <Row
                item={itemProps}
                selected={isSelected()}
                density="compact"
                leading={<Icon name={runGlyph(row().status ?? row().decision)} tone={runTone(row().status ?? row().decision)} spin={row().status === 'running'} />}
                meta={<>
                  <Text emphasis="muted">{recordStatus(row())}</Text>
                  <Show when={row().reason}>{reason => <Text emphasis="muted">{reason()}</Text>}</Show>
                  <Show when={row().result}>{result => <Text emphasis="muted">{result()}</Text>}</Show>
                  <Show when={task()}>{child => <Text emphasis="muted">{`Task: ${child().title}`}</Text>}</Show>
                  <Show when={row().taskId && !task()}><Text emphasis="muted">Task unavailable</Text></Show>
                </>}
                onPress={() => setSelectedId(row().id)}
              >
                {row().title}
              </Row>
            )
          }}
        </Rows>
      </Show>
      <Show when={page()?.next !== null && page()?.next !== undefined}>
        <Button size="sm" disabled={busy()} onPress={() => void readPage(true)}>Load next 100</Button>
      </Show>

      <Show when={selected()}>
        {row => (
          <Stack gap="row">
            <SectionHeader level="sub">{row().title}</SectionHeader>
            <Facts grouping="rows" size="sm" items={[
              { label: 'Status', value: recordStatus(row()) },
              { label: 'Decision', value: row().decision },
              { label: 'Source', value: sourceLabel() },
              ...(detail()?.provenance?.connectionId ? [{ label: 'Connection', value: detail()!.provenance!.connectionId! }] : []),
              ...(detail()?.provenance?.sourceRevision ? [{ label: 'Source revision', value: detail()!.provenance!.sourceRevision! }] : []),
              ...(detail()?.provenance?.savedQuery ? [{ label: 'Saved query', value: `${detail()!.provenance!.savedQuery!.id} · revision ${detail()!.provenance!.savedQuery!.revision}` }] : []),
              ...(detail()?.provenance?.completeness ? [{ label: 'Completeness', value: `${detail()!.provenance!.completeness!.kind}${detail()!.provenance!.completeness!.cause ? ` · ${detail()!.provenance!.completeness!.cause}` : ''}` }] : []),
              ...(detail()?.provenance?.evaluationTime ? [{ label: 'Evaluated', value: formatRelativeTime(detail()!.provenance!.evaluationTime!) }] : []),
              ...(detail()?.provenance?.readTime ? [{ label: 'Read', value: formatRelativeTime(detail()!.provenance!.readTime!) }] : []),
              ...(row().reason ? [{ label: 'Reason', value: row().reason }] : []),
            ]} />
            <Show when={row().result}>{result => <Fold label="Short result"><CodeBlock wrap maxHeight="block">{result()}</CodeBlock></Fold>}</Show>
            <Show when={detail()?.snapshot}>{snapshot => <Fold label="Frozen input"><CodeBlock wrap maxHeight="block">{JSON.stringify(snapshot(), null, 2)}</CodeBlock></Fold>}</Show>
            <Show when={detail()?.record?.outputs.length}>
              <Fold label="Declared outputs" count={detail()!.record!.outputs.length}>
                <Stack gap="row"><For each={detail()!.record!.outputs}>{output => <CodeBlock wrap maxHeight="block">{`${output.name}: ${output.preview}`}</CodeBlock>}</For></Stack>
              </Fold>
            </Show>
            <Inline wrap>
              <Show when={row().taskId && row().runId && props.tasks.some(task => task.id === row().taskId)}>
                <Button size="sm" onPress={() => props.onOpen(row().taskId!, row().runId!, { rootRunId: props.runId, recordId: row().id })}>
                  Open task and run
                </Button>
              </Show>
              <Show when={row().taskId && !props.tasks.some(task => task.id === row().taskId)}>
                <Text emphasis="muted">The child task is missing or archived. Its run history is retained here.</Text>
              </Show>
              <Show when={recordCanRetry(row())}>
                <ConfirmButton size="sm" confirmLabel="Retry attempt?" tip="Runs this failed attempt again from its original snapshot" disabled={busy()} onConfirm={() => void retry(row())}>Retry attempt</ConfirmButton>
              </Show>
              <Show when={recordCanReprocess(row())}>
                <Button size="sm" disabled={busy()} onPress={() => void prepare(row())}>Reprocess…</Button>
              </Show>
            </Inline>
            <Show when={prepared()}>{review => (
              <Alert tone="warn" title={`Reprocess ${review().title}`}>
                <Stack gap="row">
                  <Text>This creates a new root attempt from the frozen input. It does not rerun the source query or restart successful siblings.</Text>
                  <ConfirmButton size="sm" confirmLabel="Start attempt?" disabled={busy()} onConfirm={() => void reprocess(row())}>Create new attempt</ConfirmButton>
                </Stack>
              </Alert>
            )}</Show>
            <Show when={attempts().length}>
              <Fold label="Attempt history" count={attempts().length}>
                <Stack gap="row">
                  <For each={attempts()}>{attempt => (
                    <Stack gap="row">
                      <Inline wrap>
                        <Badge size="xs" tone={attempt.status === 'failed' ? 'danger' : attempt.status === 'gated' ? 'warn' : undefined}>{attempt.status}</Badge>
                        <Text emphasis="muted">{formatRelativeTime(attempt.createdAt)}</Text>
                        <Show when={props.tasks.some(task => task.id === attempt.taskId)} fallback={<Text emphasis="muted">Task unavailable</Text>}>
                          <Button size="sm" variant="bare" onPress={() => props.onOpen(attempt.taskId, attempt.runId, { rootRunId: props.runId, recordId: row().id })}>Open attempt</Button>
                        </Show>
                      </Inline>
                      <Show when={attempt.error}>{error => <Text emphasis="muted">{error()}</Text>}</Show>
                      <Show when={attempt.result}>{result => <Fold label="Attempt result"><CodeBlock wrap maxHeight="block">{result()}</CodeBlock></Fold>}</Show>
                      <Show when={attempt.outputs.length}>
                        <Fold label="Attempt outputs" count={attempt.outputs.length}>
                          <Stack gap="row"><For each={attempt.outputs}>{output => <CodeBlock wrap maxHeight="block">{`${output.name}: ${output.preview}`}</CodeBlock>}</For></Stack>
                        </Fold>
                      </Show>
                    </Stack>
                  )}</For>
                  <Show when={attemptNext()}><Button size="sm" disabled={busy()} onPress={() => void loadAttempts()}>More attempts</Button></Show>
                </Stack>
              </Fold>
            </Show>
          </Stack>
        )}
      </Show>
    </Stack>
  )
}
