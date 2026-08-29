import { For, Show } from 'solid-js'
import { bytesOf, formatSize, handlePluginContentLinkClick, openPane, type Task } from '@acorn/plugin-api/client'
import { SCRATCHPAD_SLUG } from '@acorn/protocol/notes.ts'
import { Alert, Button, EmptyState, Input, Markdown, Row, Toolbar } from '@acorn/plugin-api/ui'
import { notesModel } from './notesModel'
import type { NoteScope, NoteSummary } from './notesClient'
import { libraryCollapsed, setLibraryCollapsed } from './notesPaneState'
import './notes.css'

// The three regions of the Notes pane (docs/notes-and-memory.md § Notes). The host draws the split,
// the divider and the drag handle; these fill `list-header`, `list` and `detail`. Everything they
// share is in ./notesModel.ts.

const scopeGlyph = (scope: NoteScope): string => (scope === 'task' ? '◆ task' : scope === 'workspace' ? 'ws' : '🌐')
const authorBadge = (author: NoteSummary['author']): string => (author === 'agent' ? '🤖' : author === 'workflow' ? 'seed' : '')

export function NotesHeader(props: { task: Task }) {
  const model = () => notesModel(props.task.id, props.task.projectId)
  return (
    <div class="section-header notes-header">
      <span>{model().workspace()?.name ?? 'workspace'}</span>
      <Input kind="filter" type="text" placeholder="filter…" value={model().filter()} onInput={(value) => model().setFilter(value)} />
    </div>
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
  let titleInput: HTMLInputElement | undefined

  const IncludeDot = (dotProps: { scope: NoteScope; note: NoteSummary }) => (
    <button
      type="button"
      class="notes-include-dot"
      classList={{ on: dotProps.note.included }}
      title={dotProps.note.included ? 'Included in agent context' : 'Excluded from agent context'}
      onClick={() => void model().toggleIncluded(dotProps.scope, dotProps.note.slug, !dotProps.note.included)}
    />
  )

  // Dot, label and delete were three siblings in a wrapper because a <button> cannot nest one. Row is
  // a div[role=button], so they are its leading and trailing slots and the wrapper is gone.
  const NoteRow = (rowProps: { scope: NoteScope; note: NoteSummary }) => {
    const armed = () => model().deleteArmed.armed() === `${rowProps.scope}:${rowProps.note.slug}`
    return (
      <Row
        density="compact"
        reveal
        selected={model().isActive(rowProps.scope, rowProps.note.slug)}
        onPress={() => void model().open(rowProps.scope, rowProps.note.slug)}
        leading={<IncludeDot scope={rowProps.scope} note={rowProps.note} />}
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

  const GroupHeader = (headProps: { label: string; count: number; scope: NoteScope }) => (
    <div class="notes-group-head">
      <span class="notes-group-label">{headProps.label} ({headProps.count})</span>
      <Button
        variant="bare"
        size="sm"
        iconOnly
        tone="accent"
        title={`New ${headProps.label} note`}
        label={`New ${headProps.label} note`}
        disabled={!model().locationFor(headProps.scope)}
        onPress={() => void model().createIn(headProps.scope).then((made) => {
          if (!made) return
          // Focus lands on the title after the create round-trip, so the first thing you type is the
          // note's name.
          queueMicrotask(() => {
            titleInput = document.querySelector<HTMLInputElement>('.notes-title-input') ?? undefined
            titleInput?.focus()
            titleInput?.select()
          })
        })}
      >+</Button>
    </div>
  )

  const virtualScratchpad = (): NoteSummary => ({
    slug: SCRATCHPAD_SLUG, title: 'Scratchpad', author: 'user', kind: 'scratch', included: true, originTaskId: null, updatedAt: 0,
  })

  return (
    <>
      <GroupHeader label="Task" count={model().taskOther().length + 1} scope="task" />
      <Show when={!model().scratchpad() && model().matches(virtualScratchpad())}>
        <Row
          density="compact"
          selected={model().isActive('task', SCRATCHPAD_SLUG)}
          onPress={() => model().landScratchpad()}
          leading={<span class="notes-include-dot placeholder" />}
        >
          Scratchpad
        </Row>
      </Show>
      <Show when={model().scratchpad()}>{(note) => <NoteRow scope="task" note={note()} />}</Show>
      <For each={model().taskOther()}>{(note) => <NoteRow scope="task" note={note} />}</For>

      <GroupHeader label="Workspace" count={model().wsNotes().length} scope="workspace" />
      <For each={model().wsNotes()}>{(note) => <NoteRow scope="workspace" note={note} />}</For>

      <GroupHeader label="Global" count={model().globalNotes().length} scope="global" />
      <For each={model().globalNotes()}>{(note) => <NoteRow scope="global" note={note} />}</For>
    </>
  )
}

export function NoteBody(props: { task: Task }) {
  const model = () => notesModel(props.task.id, props.task.projectId)
  return (
    <>
      <Show when={model().actionError()}><Alert>{model().actionError()}</Alert></Show>
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
                <input
                  class="notes-title-input"
                  type="text"
                  value={model().noteTitle()}
                  placeholder="Untitled"
                  onInput={(event) => model().onTitleInput(event.currentTarget.value)}
                />
                <span class="notes-scope-pill" title={`${sel().scope} scope`}>{scopeGlyph(sel().scope)}</span>
                <button
                  type="button"
                  class="notes-include-dot"
                  classList={{ on: model().selectedIncluded() }}
                  title={model().selectedIncluded() ? 'Included in agent context' : 'Excluded from agent context'}
                  disabled={sel().virtual}
                  onClick={() => void model().toggleIncluded(sel().scope, sel().slug, !model().selectedIncluded())}
                />
                <Button size="sm" onPress={() => { model().scheduleSave.flush(); model().setPreview(!model().preview()) }}>
                  {model().preview() ? 'Edit' : 'Preview'}
                </Button>
                {/* `saving…` is a live status and stays; the completed save is an event, so it toasts. */}
                <span class="notes-save-state muted">{model().saving() ? 'saving…' : ''}</span>
              </Toolbar>
              <Show when={!model().preview()} fallback={
                <Markdown
                  text={model().body()}
                  copy
                  onClick={(event) => handlePluginContentLinkClick(event, { taskId: props.task.id })}
                />
              }>
                <textarea
                  class="notes-editor"
                  spellcheck={false}
                  value={model().body()}
                  onInput={(event) => model().onBodyInput(event.currentTarget.value)}
                  onBlur={() => model().scheduleSave.flush()}
                />
              </Show>
              <div class="notes-footer">
                <span class="muted">{formatSize(bytesOf(model().body()))}</span>
                <Button
                  variant="bare"
                  size="sm"
                  tone="accent"
                  disabled={sel().virtual}
                  onPress={() => openPane(props.task.id, 'context', { kind: 'context:reveal', sectionId: 'notes', itemId: `${sel().scope}:${sel().slug}` })}
                >
                  view in Context →
                </Button>
              </div>
            </>
          )}
        </Show>
      </Show>
    </>
  )
}
