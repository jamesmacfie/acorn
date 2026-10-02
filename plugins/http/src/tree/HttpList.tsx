// The API panel's `list` region: the project's saved requests, the task's ad-hoc ones above them, and
// the way into the variables editor (docs/http-client.md § Client).
//
// A region rather than a column inside one tree. Everything it shares with the detail beside it — the
// selection and the draft — is in ./panelModel.ts, which one worker holds for both. The delete
// confirmation stays on each row so it cannot follow selection to another request.
import { For, Show } from 'solid-js'
import {
  Button, ConfirmButton, EmptyState, Icon, IconButton, Inline, SectionHeader, Section, SegmentedControl, Stack, Text,
  Toolbar, TreeRow,
} from '@acorn/plugin-api/ui/tree'
import type { HttpRequest } from '../shared/model'
import type { HttpPanelModel, Selection } from './panelModel'

export default function HttpList(props: { model: HttpPanelModel }) {
  const model = () => props.model
  // The request the reader was on before Variables, so switching back lands on it again.
  let back: Selection = { kind: 'new' }
  const view = () => (model().selection().kind === 'variables' ? 'variables' : 'requests')
  return (
    <>
      <SectionHeader level="pane">Requests</SectionHeader>
      {/* A second bar, because a tree cannot fill a header's actions slot. No spacer: in the default
          300-pixel column the second gap is what wrapped the button onto its own line. */}
      <Toolbar variant="actions" size="sm">
        <SegmentedControl
          size="sm"
          ariaLabel="Show"
          value={view()}
          options={[{ value: 'requests', label: 'Requests' }, { value: 'variables', label: 'Variables' }]}
          onChange={(value: string) => {
            if (value === view()) return
            if (value === 'variables') {
              back = model().selection()
              model().setSelection({ kind: 'variables' })
            } else model().setSelection(back)
          }}
        />
        <Button size="sm" variant="ghost" onPress={() => model().startNew()}>
          <Icon name="plus" /> New request
        </Button>
      </Toolbar>

      <Stack gap="row">
        <Show when={model().recoveries().length}>
          <Section label="Recover unsaved edits">
            <For each={model().recoveries()}>{(entry) =>
              <Button variant="bare" size="sm" onPress={() => model().recover(entry.key)}>{entry.name}</Button>
            }</For>
          </Section>
        </Show>
        <Show when={model().taskId}>
          <Section label="This task" help="Requests you make here stay with this task until you save them to the project.">
            <Show
              when={(model().adhoc() ?? []).length}
              fallback={<EmptyState align="start" size="sm">No requests in this task</EmptyState>}
            >
              <For each={model().adhoc()}>{(row) => <RequestRow model={model()} row={row} />}</For>
            </Show>
          </Section>
        </Show>

        {/* A folder name is content, so it keeps its own case. */}
        <For each={model().groups()}>
          {(group) => (
            <Stack gap="none">
              <SectionHeader level="sub">{group.folder || 'Ungrouped'}</SectionHeader>
              <For each={group.requests}>{(row) => <RequestRow model={model()} row={row} />}</For>
            </Stack>
          )}
        </For>

        <Show when={model().saved.state === 'ready' && !(model().saved() ?? []).length && !model().taskId}>
          <EmptyState align="start" size="sm">No saved requests in this project</EmptyState>
        </Show>
      </Stack>
    </>
  )
}

// Named RequestRow because the shared component owns the name TreeRow. This adapter adds the leading
// method label and the two row actions.
//
// The method chip's colour-per-verb went with the stylesheet: a plugin no longer names a colour, and
// the kit has no role that means "POST". The verb is still the first thing on the row, in mono.
function RequestRow(props: { model: HttpPanelModel; row: HttpRequest }) {
  return (
    <TreeRow
      depth={1}
      reveal
      selected={props.model.current()?.id === props.row.id}
      onPress={() => props.model.open(props.row)}
      leading={props.row.method}
    >
      <Inline>
        <Text>{props.row.name}</Text>
        <IconButton size="xs" icon="copy" label="Duplicate" onPress={() => props.model.startNew(props.row)} />
        {/* Two clicks, not a dialog. The label changes so the second click is not a surprise, and it is
            the affordance rather than a tooltip because a tooltip is not an answer to "did that do
            anything". */}
        <ConfirmButton
          variant="ghost"
          size="xs"
          iconOnly
          tip={`Delete ${props.row.name}`}
          label="Delete"
          confirmLabel="Delete request?"
          onConfirm={() => void props.model.remove(props.row)}
        >
          <Icon name="trash-2" />
        </ConfirmButton>
      </Inline>
    </TreeRow>
  )
}
