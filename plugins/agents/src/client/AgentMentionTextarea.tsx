import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { readJson } from '@acorn/plugin-api/client'
import { editorFilesRoute } from '@acorn/plugin-editor/contract/api.ts'
import { Alert, Button, Textarea } from '@acorn/plugin-api/ui'
import {
  activeFileMention,
  completeFileMention,
  fileMentionSuggestions,
  type ActiveFileMention,
} from './fileMentions'

export default function AgentMentionTextarea(props: {
  taskId: string
  value: string
  disabled?: boolean
  placeholder: string
  onValue(value: string): void
  onFiles(files: File[]): void
  onSubmit(): void
}) {
  const [files] = createResource(
    () => props.taskId,
    (taskId) => readJson<string[]>(editorFilesRoute(taskId)),
  )
  const [mention, setMention] = createSignal<ActiveFileMention | null>(null)
  const [focused, setFocused] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [selected, setSelected] = createSignal(0)
  const suggestions = createMemo(() =>
    fileMentionSuggestions(files() ?? [], mention()?.query ?? ''))
  const showSuggestions = () =>
    focused() && !dismissed() && mention() != null

  let textarea: HTMLTextAreaElement | undefined

  const updateMention = (value: string, cursor: number | null) => {
    setDismissed(false)
    setMention(cursor == null ? null : activeFileMention(value, cursor))
    setSelected(0)
  }

  const choose = (path: string) => {
    const active = mention()
    if (!active) return
    const completed = completeFileMention(props.value, active, path)
    props.onValue(completed.text)
    setMention(null)
    setDismissed(false)
    queueMicrotask(() => {
      textarea?.focus()
      textarea?.setSelectionRange(completed.cursor, completed.cursor)
    })
  }

  createEffect(() => {
    const count = suggestions().length
    if (selected() >= count) setSelected(Math.max(0, count - 1))
  })

  return (
    <div class="agent-mention-input">
      <Textarea
        ref={textarea}
        class="agent-composer-input"
        value={props.value}
        disabled={props.disabled}
        aria-label="Message agent"
        placeholder={props.placeholder}
        rows="3"
        onFocus={(event) => {
          setFocused(true)
          updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
        }}
        onBlur={() => setFocused(false)}
        onClick={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart)}
        onInput={(event) => {
          props.onValue(event.currentTarget.value)
          updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
        }}
        onPaste={(event) => {
          const pastedFiles = [...(event.clipboardData?.files ?? [])]
          if (!pastedFiles.length) return
          event.preventDefault()
          props.onFiles(pastedFiles)
        }}
        onDragOver={(event) => {
          if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
        }}
        onDrop={(event) => {
          const droppedFiles = [...(event.dataTransfer?.files ?? [])]
          if (!droppedFiles.length) return
          event.preventDefault()
          props.onFiles(droppedFiles)
        }}
        onKeyUp={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return
          updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
        }}
        onKeyDown={(event) => {
          if (event.isComposing) return
          if (showSuggestions()) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelected((current) => Math.min(current + 1, Math.max(0, suggestions().length - 1)))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelected((current) => Math.max(0, current - 1))
              return
            }
            if ((event.key === 'Enter' || event.key === 'Tab') && suggestions()[selected()]) {
              event.preventDefault()
              choose(suggestions()[selected()])
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDismissed(true)
              return
            }
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            props.onSubmit()
          }
        }}
      />
      <Show when={showSuggestions()}>
        <div class="agent-mention-suggestions" role="listbox" aria-label="Worktree files">
          <Show when={!files.loading} fallback={<p class="muted">Loading files…</p>}>
            <Show
              when={!files.error}
              fallback={<Alert>Unable to load worktree files.</Alert>}
            >
              <For
                each={suggestions()}
                fallback={<p class="muted">No matching files.</p>}
              >
                {(path, index) => {
                  const slash = path.lastIndexOf('/')
                  const name = slash < 0 ? path : path.slice(slash + 1)
                  const directory = slash < 0 ? '' : path.slice(0, slash)
                  return (
                    <Button
                      variant="bare"
                      class="agent-mention-suggestion"
                      classList={{ selected: index() === selected() }}
                      role="option"
                      aria-selected={index() === selected()}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setSelected(index())}
                      onClick={() => choose(path)}
                    >
                      <strong>{name}</strong>
                      <Show when={directory}><small>{directory}</small></Show>
                    </Button>
                  )
                }}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  )
}
