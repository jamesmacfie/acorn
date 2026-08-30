// The API panel's `list` region: the project's saved requests, the task's ad-hoc ones above them, and
// the way into the variables editor (docs/http-client.md § Client).
//
// A region rather than a column inside one tree. Everything it shares with the detail beside it — the
// selection, the draft, the armed delete — is in ./panelModel.ts, which one worker holds for both.
import { For, Show } from 'solid-js'
import {
  Button, EmptyState, Icon, Inline, SectionHeader, Section, Stack, Text, Toolbar, TreeRow,
} from '@acorn/plugin-api/ui/tree'
import type { HttpRequest } from '../shared/model'
import type { HttpPanelModel } from './panelModel'

export default function HttpList(props: { model: HttpPanelModel }) {
  const model = () => props.model
  return (
    <>
      <SectionHeader level="pane">{model().projectName}</SectionHeader>
      <Toolbar variant="actions" size="sm">
        <Button size="sm" variant="ghost" onPress={() => model().startNew()}>+ Request</Button>
      </Toolbar>

      <Stack gap="row">
        <Show when={model().taskId}>
          <Section label="This task">
            <Show
              when={(model().adhoc() ?? []).length}
              fallback={<EmptyState align="start" size="sm">Nothing yet — new requests you make here stay with this task until you file them.</EmptyState>}
            >
              <For each={model().adhoc()}>{(row) => <RequestRow model={model()} row={row} />}</For>
            </Show>
          </Section>
        </Show>

        <For each={model().groups()}>
          {(group) => (
            <Section label={group.folder || 'Ungrouped'}>
              <For each={group.requests}>{(row) => <RequestRow model={model()} row={row} />}</For>
            </Section>
          )}
        </For>

        <Show when={model().saved.state === 'ready' && !(model().saved() ?? []).length && !model().taskId}>
          <EmptyState align="start" size="sm">No saved requests for this project yet.</EmptyState>
        </Show>
      </Stack>

      <Toolbar variant="actions" size="sm">
        <Button
          size="sm"
          variant={model().selection().kind === 'variables' ? 'solid' : 'bare'}
          onPress={() => model().setSelection({ kind: 'variables' })}
        >
          <Icon name="braces" /> Variables
        </Button>
      </Toolbar>
    </>
  )
}

// Named RequestRow because the shared component owns the name TreeRow. This adapter adds the leading
// method label and the two row actions.
//
// The method chip's colour-per-verb went with the stylesheet: a plugin no longer names a colour, and
// the kit has no role that means "POST". The verb is still the first thing on the row, in mono.
function RequestRow(props: { model: HttpPanelModel; row: HttpRequest }) {
  const armed = () => props.model.armedDelete.armed() === props.row.id
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
        <Button variant="bare" size="sm" title="Duplicate as a new request" label="Duplicate" onPress={() => props.model.startNew(props.row)}>
          <Icon name="copy" />
        </Button>
        {/* Two clicks, not a dialog. The label changes so the second click is not a surprise, and it is
            the affordance rather than a tooltip because a tooltip is not an answer to "did that do
            anything". */}
        <Button
          variant="bare"
          size="sm"
          tone={armed() ? 'danger' : undefined}
          title={armed() ? `Click again to delete "${props.row.name}"` : 'Delete'}
          label={armed() ? 'Confirm delete' : 'Delete'}
          onPress={() => void props.model.remove(props.row)}
        >
          <Show when={armed()} fallback={<Icon name="trash-2" />}>Delete?</Show>
        </Button>
      </Inline>
    </TreeRow>
  )
}
