import { Show } from 'solid-js'
import { openInAppUrl, openPane, type Task } from '@acorn/plugin-api/client'
import { NOTE_AUTHOR_LABEL, NOTE_SCOPE_LABEL, SCRATCHPAD_SLUG } from '@acorn/protocol/notes.ts'
import {
  Alert, Badge, Button, Checkbox, EmptyState, IconButton, Input, Markdown, Menu, Row, RowActions, Rows, Section,
  SectionHeader, SegmentedControl, Stack, Text, Textarea, Toolbar,
} from '@acorn/plugin-api/ui'
import type { NotesModel } from './notesModel'
import type { NoteScope, NoteSummary } from './notesClient'

// The three regions of the Notes pane (docs/notes-and-memory.md § Notes). The host draws the split,
// the divider and the drag handle; these fill `list-header`, `list` and `detail`. Everything they
// share is in ./notesModel.ts.

const NEW_NOTE_LABEL: Record<NoteScope, string> = {
  task: 'New task note', workspace: 'New workspace note', global: 'New note for everywhere',
}

const virtualScratchpad = (): NoteSummary => ({
  slug: SCRATCHPAD_SLUG, title: 'Scratchpad', author: 'user', kind: 'scratch', included: true, originTaskId: null, updatedAt: 0,
})

// The task group is the scratchpad (real or offered) plus everything else, as one collection, so the
// arrows walk it in the order it is drawn.
const taskRowsOf = (model: NotesModel): NoteSummary[] => {
  const rows = model.scratchpad() ? [model.scratchpad()!] : model.matches(virtualScratchpad()) ? [virtualScratchpad()] : []
  return [...rows, ...model.taskOther()]
}

// The house list header: the label and the count of rows shown, with the filter as its control.
export function NotesHeader(props: { task: Task; model: NotesModel }) {
  const model = () => props.model
  const count = () => taskRowsOf(model()).length + model().wsNotes().length + model().globalNotes().length
  return (
    <SectionHeader
      count={count()}
      actions={<Input kind="filter" size="sm" label="Filter notes" placeholder="Filter notes…" value={model().filter()} onInput={(value) => model().setFilter(value)} />}
    >
      Notes
    </SectionHeader>
  )
}

export function NotesList(props: { task: Task; model: NotesModel }) {
  const model = () => props.model

  // "In the agent's context" as the checkbox it always was. It used to be a 10px round button with a
  // stylesheet of its own; the state it reports and the state a Checkbox reports are the same state.
  // The row's last trailing control, as an include or stage box is in every list, so titles keep one
  // left edge whether or not a row has a box.
  const IncludeBox = (boxProps: { scope: NoteScope; note: NoteSummary }) => (
    <Checkbox
      size="sm"
      checked={boxProps.note.included}
      ariaLabel="Include in the agent's context"
      title="Include in the agent's context"
      onChange={(checked) => void model().toggleIncluded(boxProps.scope, boxProps.note.slug, checked)}
    />
  )

  const NoteRow = (rowProps: { scope: NoteScope; note: NoteSummary; item?: Parameters<Parameters<typeof Rows>[0]['children']>[1] }) => {
    return (
      <Row
        item={rowProps.item}
        density="compact"
        label={rowProps.note.title}
        selected={model().isActive(rowProps.scope, rowProps.note.slug)}
        onPress={() => void model().open(rowProps.scope, rowProps.note.slug)}
        meta={NOTE_AUTHOR_LABEL[rowProps.note.author] ? <Badge size="xs">{NOTE_AUTHOR_LABEL[rowProps.note.author]}</Badge> : undefined}
        trailing={
          <>
            <RowActions ariaLabel={`Actions for ${rowProps.note.title}`}>
              {(menu) => (
                <Menu.Item
                  context={menu}
                  tone="danger"
                  confirm="Delete note?"
                  onSelect={() => void model().remove(rowProps.scope, rowProps.note.slug)}
                >
                  Delete
                </Menu.Item>
              )}
            </RowActions>
            <IncludeBox scope={rowProps.scope} note={rowProps.note} />
          </>
        }
      >
        {rowProps.note.title}
      </Row>
    )
  }

  const NewButton = (headProps: { scope: NoteScope }) => (
    <IconButton
      icon="plus"
      tone="accent"
      label={NEW_NOTE_LABEL[headProps.scope]}
      disabled={!model().locationFor(headProps.scope)}
      onPress={() => void model().createIn(headProps.scope).then((made) => {
        // Focus lands on the title after the create round-trip, so the first thing you type is the
        // note's name. The kit gives a pane no handle on a control it did not place, so the model
        // asks for the focus and the title field answers.
        if (made) model().requestTitleFocus()
      })}
    />
  )


  const Group = (groupProps: { label: string; scope: NoteScope; notes: readonly NoteSummary[] }) => (
    <Section
      label={groupProps.label}
      count={groupProps.notes.length}
      actions={<NewButton scope={groupProps.scope} />}
    >
      <Rows
        id={`notes.${props.task.id}.${groupProps.scope}`}
        ariaLabel={`${groupProps.label} notes`}
        items={groupProps.notes.map((note) => ({ key: note.slug, label: note.title, note }))}
      >
        {(entry, item) => (
          <Show
            when={!(entry.note.slug === SCRATCHPAD_SLUG && !model().scratchpad())}
            fallback={
              <Row item={item} density="compact" selected={model().isActive('task', SCRATCHPAD_SLUG)} onPress={() => model().landScratchpad()}>
                Scratchpad
              </Row>
            }
          >
            <NoteRow scope={groupProps.scope} note={entry.note} item={item} />
          </Show>
        )}
      </Rows>
    </Section>
  )

  return (
    <Stack gap="none">
      <Group label={NOTE_SCOPE_LABEL.task} scope="task" notes={taskRowsOf(model())} />
      <Group label={NOTE_SCOPE_LABEL.workspace} scope="workspace" notes={model().wsNotes()} />
      <Group label={NOTE_SCOPE_LABEL.global} scope="global" notes={model().globalNotes()} />
    </Stack>
  )
}

export function NoteBody(props: { task: Task; model: NotesModel }) {
  const model = () => props.model
  return (
    <>
      <Show when={model().actionError()}>{(error) => <Alert>{error()}</Alert>}</Show>
      <Show when={model().api} fallback={<EmptyState>Notes need the desktop app.</EmptyState>}>
        <Show
          when={model().selected()}
          fallback={<EmptyState title="No note open">Pick one from the list, or press + to start one.</EmptyState>}
        >
          {(sel) => (
            <>
              <Toolbar ariaLabel="Note actions">
                <Input
                  kind="bare"
                  size="sm"
                  label="Note title"
                  placeholder="Untitled"
                  value={model().noteTitle()}
                  ref={model().titleRef}
                  onInput={(value) => model().onTitleInput(value)}
                />
                <Badge size="xs">{NOTE_SCOPE_LABEL[sel().scope]}</Badge>
                <Checkbox
                  size="sm"
                  checked={model().selectedIncluded()}
                  disabled={sel().virtual}
                  ariaLabel="Include in the agent's context"
                  title="Include in the agent's context"
                  onChange={(checked) => void model().toggleIncluded(sel().scope, sel().slug, checked)}
                />
                {/* Two named states, so the control says where you are rather than where a press goes. */}
                <SegmentedControl
                  size="sm"
                  ariaLabel="Note view"
                  value={model().preview() ? 'preview' : 'edit'}
                  options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]}
                  onChange={(value) => { model().scheduleSave.flush(); model().setPreview(value === 'preview') }}
                />
                {/* `Saving…` is a live status and stays; the completed save is an event, so it toasts. */}
                <Text emphasis="muted">{model().saving() ? 'Saving…' : ''}</Text>
                <Toolbar.Spacer />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={sel().virtual}
                  onPress={() => openPane(props.task.id, 'context', { kind: 'context:reveal', sectionId: 'notes', itemId: `${sel().scope}:${sel().slug}` })}
                >
                  Show in Context
                </Button>
              </Toolbar>
              <Show when={!model().preview()} fallback={
                <Markdown
                  text={model().body()}
                  copy
                  onSelect={(href) => openInAppUrl(href, { taskId: props.task.id })}
                />
              }>
                <Textarea
                  grow
                  mono
                  label="Note body"
                  assist={false}
                  value={model().body()}
                  onInput={(value) => model().onBodyInput(value)}
                  onBlur={() => model().scheduleSave.flush()}
                />
              </Show>
            </>
          )}
        </Show>
      </Show>
    </>
  )
}
