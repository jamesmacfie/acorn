import { Show } from 'solid-js'
import { bytesOf, formatSize, handlePluginContentLinkClick, openPane, type Task } from '@acorn/plugin-api/client'
import { SCRATCHPAD_SLUG } from '@acorn/protocol/notes.ts'
import {
  Alert, Button, Checkbox, EmptyState, Input, Markdown, Row, Rows, Section, Stack, Text, Textarea,
  ToggleButton, Toolbar,
} from '@acorn/plugin-api/ui'
import { notesModel } from './notesModel'
import type { NoteScope, NoteSummary } from './notesClient'
import { libraryCollapsed, setLibraryCollapsed } from './notesPaneState'

// The three regions of the Notes pane (docs/notes-and-memory.md § Notes). The host draws the split,
// the divider and the drag handle; these fill `list-header`, `list` and `detail`. Everything they
// share is in ./notesModel.ts.

const scopeGlyph = (scope: NoteScope): string => (scope === 'task' ? '◆ task' : scope === 'workspace' ? 'ws' : '🌐')
const authorBadge = (author: NoteSummary['author']): string => (author === 'agent' ? '🤖' : author === 'workflow' ? 'seed' : '')

export function NotesHeader(props: { task: Task }) {
  const model = () => notesModel(props.task.id, props.task.projectId)
  return (
    <Toolbar size="sm" ariaLabel="Notes library">
      <Text emphasis="muted">{model().workspace()?.name ?? 'workspace'}</Text>
      <Input kind="filter" size="sm" label="Filter notes" placeholder="filter…" value={model().filter()} onInput={(value) => model().setFilter(value)} />
    </Toolbar>
  )
}

// Collapsing the library hides the whole list column, header and all, so the toggle cannot live in it.
// It sits at the left of the note's own toolbar, which is where the boundary is.
function LibraryToggle(props: { task: Task }) {
  const collapsed = () => libraryCollapsed(props.task.id)
  return (
    <Button
      variant="bare"
      size="sm"
      iconOnly
      title={collapsed() ? 'Show library' : 'Hide library'}
      label={collapsed() ? 'Show library' : 'Hide library'}
      onPress={() => setLibraryCollapsed(props.task.id, !collapsed())}
    >{collapsed() ? '▶' : '◀'}</Button>
  )
}

export function NotesList(props: { task: Task }) {
  const model = () => notesModel(props.task.id, props.task.projectId)

  // "In the agent's context" as the checkbox it always was. It used to be a 10px round button with a
  // stylesheet of its own; the state it reports and the state a Checkbox reports are the same state.
  const IncludeBox = (boxProps: { scope: NoteScope; note: NoteSummary }) => (
    <Checkbox
      size="sm"
      checked={boxProps.note.included}
      ariaLabel={boxProps.note.included ? 'Included in agent context' : 'Excluded from agent context'}
      title={boxProps.note.included ? 'Included in agent context' : 'Excluded from agent context'}
      onChange={(checked) => void model().toggleIncluded(boxProps.scope, boxProps.note.slug, checked)}
    />
  )

  const NoteRow = (rowProps: { scope: NoteScope; note: NoteSummary; item?: Parameters<Parameters<typeof Rows>[0]['children']>[1] }) => {
    const armed = () => model().deleteArmed.armed() === `${rowProps.scope}:${rowProps.note.slug}`
    return (
      <Row
        item={rowProps.item}
        density="compact"
        reveal
        label={rowProps.note.title}
        selected={model().isActive(rowProps.scope, rowProps.note.slug)}
        onPress={() => void model().open(rowProps.scope, rowProps.note.slug)}
        leading={<IncludeBox scope={rowProps.scope} note={rowProps.note} />}
        meta={authorBadge(rowProps.note.author)}
        trailing={
          <Button
            variant="bare"
            size="sm"
            iconOnly
            title={armed() ? `Click again to remove “${rowProps.note.slug}”` : 'Delete note'}
            label="Delete note"
            onPress={() => void model().remove(rowProps.scope, rowProps.note.slug)}
          >{armed() ? '?' : '✕'}</Button>
        }
      >
        {rowProps.note.title}
      </Row>
    )
  }

  const NewButton = (headProps: { label: string; scope: NoteScope }) => (
    <Button
      variant="bare"
      size="sm"
      iconOnly
      tone="accent"
      title={`New ${headProps.label} note`}
      label={`New ${headProps.label} note`}
      disabled={!model().locationFor(headProps.scope)}
      onPress={() => void model().createIn(headProps.scope).then((made) => {
        // Focus lands on the title after the create round-trip, so the first thing you type is the
        // note's name. The kit gives a pane no handle on a control it did not place, so the model
        // asks for the focus and the title field answers.
        if (made) model().requestTitleFocus()
      })}
    >+</Button>
  )

  const virtualScratchpad = (): NoteSummary => ({
    slug: SCRATCHPAD_SLUG, title: 'Scratchpad', author: 'user', kind: 'scratch', included: true, originTaskId: null, updatedAt: 0,
  })

  // The task group is the scratchpad (real or offered) plus everything else, as one collection, so the
  // arrows walk it in the order it is drawn.
  const taskRows = () => {
    const rows = model().scratchpad() ? [model().scratchpad()!] : model().matches(virtualScratchpad()) ? [virtualScratchpad()] : []
    return [...rows, ...model().taskOther()]
  }

  const Group = (groupProps: { label: string; scope: NoteScope; notes: readonly NoteSummary[] }) => (
    <Section
      label={groupProps.label}
      count={groupProps.notes.length}
      actions={<NewButton label={groupProps.label} scope={groupProps.scope} />}
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
      <Group label="Task" scope="task" notes={taskRows()} />
      <Group label="Workspace" scope="workspace" notes={model().wsNotes()} />
      <Group label="Global" scope="global" notes={model().globalNotes()} />
    </Stack>
  )
}

export function NoteBody(props: { task: Task }) {
  const model = () => notesModel(props.task.id, props.task.projectId)
  return (
    <>
      <Show when={model().actionError()}>{(error) => <Alert>{error()}</Alert>}</Show>
      <Show when={model().api} fallback={<EmptyState>Notes need the desktop app.</EmptyState>}>
        <Show
          when={model().selected()}
          fallback={
            <>
              <Toolbar size="sm" ariaLabel="Note actions"><LibraryToggle task={props.task} /></Toolbar>
              <EmptyState>Select or create a note.</EmptyState>
            </>
          }
        >
          {(sel) => (
            <>
              <Toolbar size="sm" ariaLabel="Note actions">
                <LibraryToggle task={props.task} />
                <Input
                  kind="bare"
                  size="sm"
                  label="Note title"
                  placeholder="Untitled"
                  value={model().noteTitle()}
                  ref={model().titleRef}
                  onInput={(value) => model().onTitleInput(value)}
                />
                <Text emphasis="muted">{scopeGlyph(sel().scope)}</Text>
                <Checkbox
                  size="sm"
                  checked={model().selectedIncluded()}
                  disabled={sel().virtual}
                  ariaLabel={model().selectedIncluded() ? 'Included in agent context' : 'Excluded from agent context'}
                  title={model().selectedIncluded() ? 'Included in agent context' : 'Excluded from agent context'}
                  onChange={(checked) => void model().toggleIncluded(sel().scope, sel().slug, checked)}
                />
                <ToggleButton
                  size="sm"
                  label={model().preview() ? 'Edit' : 'Preview'}
                  pressed={model().preview()}
                  onPressedChange={() => { model().scheduleSave.flush(); model().setPreview(!model().preview()) }}
                />
                {/* `saving…` is a live status and stays; the completed save is an event, so it toasts. */}
                <Text emphasis="muted">{model().saving() ? 'saving…' : ''}</Text>
              </Toolbar>
              <Show when={!model().preview()} fallback={
                <Markdown
                  text={model().body()}
                  copy
                  onClick={(event) => handlePluginContentLinkClick(event, { taskId: props.task.id })}
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
              <Toolbar size="sm" ariaLabel="Note status">
                <Text emphasis="muted">{formatSize(bytesOf(model().body()))}</Text>
                <Toolbar.Spacer />
                <Button
                  variant="bare"
                  size="sm"
                  tone="accent"
                  disabled={sel().virtual}
                  onPress={() => openPane(props.task.id, 'context', { kind: 'context:reveal', sectionId: 'notes', itemId: `${sel().scope}:${sel().slug}` })}
                >
                  view in Context →
                </Button>
              </Toolbar>
            </>
          )}
        </Show>
      </Show>
    </>
  )
}
