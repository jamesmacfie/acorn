// The trigger dialog's parts for **When records change**: which records, which change starts a run,
// how often to check, what matches now, and what the trigger started (docs/workflows/triggers.md).
import { For, Show } from 'solid-js'
import { Alert, Button, Field, Fold, Inline, Input, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { SourceQueryEditor, TypedBindingPicker } from '@acorn/plugin-api/ui/data-sources'
import type { DataBinding } from '@acorn/protocol/dataBindings.ts'
import type { Cadence } from '@acorn/protocol/schedules.ts'
import type {
  WorkflowRecordsWhen,
  WorkflowTriggerMatch,
  WorkflowTriggerPreview,
  WorkflowTriggerView,
} from '../../shared/workflowTriggers'
import { changeLabel } from './triggerModel'

/** The setup a record trigger edits. `query` is unset until a source is chosen. */
export type RecordsDraft = Omit<WorkflowRecordsWhen, 'kind' | 'query'> & { query?: WorkflowRecordsWhen['query'] }

/** The record a pointer reads, as the shared field picker offers it. */
export const recordOrigin = (preview: WorkflowTriggerPreview) => [
  { kind: 'item' as const, label: preview.source.label, schema: preview.source.schema, fields: preview.source.fields },
]

const CHECK_MINUTES = [1, 5, 15, 60]

export function RecordsWhenFields(props: {
  workspaceId: string
  projectId: string
  draft: RecordsDraft
  cadence: Cadence
  preview?: WorkflowTriggerPreview
  previewing: boolean
  onDraft(patch: Partial<RecordsDraft>): void
  onCadence(cadence: Cadence): void
  onPreview(): void
}) {
  const fields = () => (props.draft.change.on === 'changes' ? props.draft.change.fields : [])
  const tracked = () => (fields().length ? fields() : [''])
  const setField = (index: number, binding: DataBinding | undefined): void => {
    const next = [...fields()]
    next[index] = binding?.address.from === 'item' ? binding.address.pointer : ''
    props.onDraft({ change: { on: 'changes', fields: next.filter(Boolean) } })
  }
  const minutes = () => ('every' in props.cadence ? Math.round(props.cadence.every / 60) : 5)
  const incrementalOffered = () => props.draft.change.on !== 'enters' && !!props.preview?.source.incremental
  const starting = () => props.preview?.records.filter((record) => record.wouldStart).length ?? 0

  return (
    <Stack gap="stack">
      <Field label="Records from" group>
        <SourceQueryEditor
          workspaceId={props.workspaceId}
          projectId={props.projectId}
          value={props.draft.query}
          hideAuthoring
          onChange={(query) => props.onDraft({ query })}
        />
      </Field>
      <Field label="Start a run when a record" group>
        <Select
          label="Start a run when a record"
          value={props.draft.change.on}
          options={(['new', 'enters', 'changes'] as const).map((on) => ({ value: on, label: changeLabel(on) }))}
          onChange={(on) =>
            props.onDraft({
              change: on === 'changes' ? { on, fields: fields() } : { on: on as 'new' | 'enters' },
              ...(on === 'enters' ? { incremental: false } : {}),
            })
          }
        />
      </Field>
      <Show when={props.draft.change.on === 'changes'}>
        <Show
          when={props.preview}
          fallback={<Text emphasis="muted">Preview the matches to choose the fields to watch.</Text>}
        >
          {(preview) => (
            <Stack gap="row">
              <For each={tracked()}>
                {(pointer, index) => (
                  <TypedBindingPicker
                    label={`Watched field ${index() + 1}`}
                    origins={recordOrigin(preview())}
                    value={pointer ? { address: { from: 'item', pointer } } : undefined}
                    onChange={(binding) => setField(index(), binding)}
                  />
                )}
              </For>
              <Button size="sm" onPress={() => props.onDraft({ change: { on: 'changes', fields: [...fields(), ''] } })}>
                Add watched field
              </Button>
            </Stack>
          )}
        </Show>
      </Show>
      <Field label="Check every" group>
        <Select
          label="Check every"
          value={String(minutes())}
          options={CHECK_MINUTES.map((value) => ({
            value: String(value),
            label: value === 1 ? '1 minute' : value === 60 ? '1 hour' : `${value} minutes`,
          }))}
          onChange={(value) => props.onCadence({ every: Number(value) * 60 })}
        />
      </Field>
      <Field label="Read" group>
        <Select
          label="Read"
          value={props.draft.incremental ? 'checkpoint' : 'all'}
          options={[
            { value: 'all', label: 'Every match, each check' },
            ...(incrementalOffered() ? [{ value: 'checkpoint', label: 'Only what changed since the last check' }] : []),
          ]}
          onChange={(value) => props.onDraft({ incremental: value === 'checkpoint' })}
        />
      </Field>
      <Show when={props.draft.change.on === 'enters'}>
        <Text emphasis="muted" wrap>
          Starts matching reads every match each check, because it has to see which records stopped matching.
        </Text>
      </Show>
      <Field label="Most runs a check" hint="Up to 10. A record over the limit waits for the next check." group>
        <Input
          type="number"
          width="narrow"
          label="Most runs a check"
          value={String(props.draft.runsPerCheck ?? 10)}
          onInput={(raw) => props.onDraft({ runsPerCheck: Math.min(10, Math.max(1, Number(raw) || 1)) })}
        />
      </Field>
      <Inline gap="inline" wrap>
        <Button
          size="sm"
          disabled={!props.draft.query || props.previewing}
          busy={props.previewing}
          onPress={props.onPreview}
        >
          Preview matches
        </Button>
      </Inline>
      <Show when={props.preview}>
        {(preview) => (
          <Stack gap="row">
            <Text wrap>
              {preview().records.length
                ? `Process current matches would start ${starting()} of these ${preview().records.length}. Start tracking from now starts none until something new happens.`
                : 'Nothing matches now.'}
            </Text>
            <Show when={preview().partial}>
              <Text emphasis="muted" wrap>{`Read part of the results: ${preview().partial}`}</Text>
            </Show>
            <For each={preview().records}>
              {(record) => (
                <Text emphasis={record.wouldStart ? undefined : 'muted'}>
                  {`${record.title}${record.wouldStart ? ' · would start' : ''}`}
                </Text>
              )}
            </For>
          </Stack>
        )}
      </Show>
    </Stack>
  )
}

const reasonLabel = (reason: WorkflowTriggerMatch['reason']): string =>
  reason === 'new' ? 'New' : reason === 'enters' ? 'Started matching' : 'Changed'

/** The last check and the last 50 matches, each opening its run. */
export function RecordMatchHistory(props: {
  trigger: WorkflowTriggerView
  onOpenRun(match: WorkflowTriggerMatch): void
}) {
  return (
    <Stack gap="row">
      <Show when={props.trigger.lastCheck}>
        {(check) => (
          <Show
            when={check().partial}
            fallback={
              <Text emphasis="muted">{`Last checked ${new Date(check().at).toLocaleString()}. Read every match.`}</Text>
            }
          >
            <Alert tone="warn" title="Last check read part of the results">
              {check().partial}
            </Alert>
          </Show>
        )}
      </Show>
      <Fold label={`Matches (${props.trigger.matches?.length ?? 0})`} level="group" defaultOpen>
        <Stack gap="row">
          <For each={props.trigger.matches} fallback={<Text emphasis="muted">No matches yet.</Text>}>
            {(match) => (
              <Inline gap="inline" wrap>
                <Text>{`${match.title} · ${reasonLabel(match.reason)} · ${match.runStatus ?? match.state}`}</Text>
                <Show when={match.state !== 'blocked'} fallback={<Text emphasis="muted">{match.detail}</Text>}>
                  <Button size="sm" variant="ghost" onPress={() => props.onOpenRun(match)}>
                    Open run
                  </Button>
                </Show>
              </Inline>
            )}
          </For>
        </Stack>
      </Fold>
    </Stack>
  )
}
