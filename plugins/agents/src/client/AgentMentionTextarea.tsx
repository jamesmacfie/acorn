import { createEffect, createMemo, createResource, createSignal, For, Index, Show } from 'solid-js'
import { readJson } from '@acorn/plugin-api/client'
import { editorFilesRoute } from '@acorn/plugin-editor/contract/api.ts'
import { Alert, Button, Icon, PickerRow, Textarea, tip } from '@acorn/plugin-api/ui'
import {
  activeMention,
  completeMention,
  fileMentionSuggestions,
  formatFileMention,
  type ActiveMention,
} from './fileMentions'
import {
  advertisedSuggestions,
  composerSegments,
  MAX_HIGHLIGHT_LENGTH,
  scrollDeltaFor,
  type AdvertisedItem,
} from './composerTokens'

/** One row of the dropdown. `value` is the text that replaces the mention under the caret. */
type MentionSuggestion = { value: string; label: string; detail?: string }

export default function AgentMentionTextarea(props: {
  taskId: string
  value: string
  commands?: readonly AdvertisedItem[]
  skills?: readonly AdvertisedItem[]
  expanded?: boolean
  disabled?: boolean
  placeholder: string
  onValue(value: string): void
  onFiles(files: File[]): void
  onSubmit(): void
  onToggleExpanded?: () => void
}) {
  // Only fetched for `@`. A session whose composer never asks for a file never pays for the walk.
  const [files] = createResource(
    () => props.taskId,
    (taskId) => readJson<string[]>(editorFilesRoute(taskId)),
  )
  const [mention, setMention] = createSignal<ActiveMention | null>(null)
  const [focused, setFocused] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [selected, setSelected] = createSignal(0)
  const commands = createMemo(() => props.commands ?? [])
  const skills = createMemo(() => props.skills ?? [])
  const names = createMemo(() => ({
    commands: commands().map((command) => command.name),
    skills: skills().map((skill) => skill.name),
  }))
  const describe = (kind: 'command' | 'skill', name: string) =>
    (kind === 'command' ? commands() : skills()).find((item) => item.name === name)?.description

  const advertised = (sigil: '/' | '$', items: readonly AdvertisedItem[], query: string) =>
    advertisedSuggestions(items, query).map((item) => ({
      value: `${sigil}${item.name}`,
      label: `${sigil}${item.name}`,
      detail: item.description,
    }))

  const suggestions = createMemo<MentionSuggestion[]>(() => {
    const active = mention()
    if (!active) return []
    if (active.sigil === '/') return advertised('/', commands(), active.query)
    if (active.sigil === '$') return advertised('$', skills(), active.query)
    return fileMentionSuggestions(files() ?? [], active.query).map((path) => {
      const slash = path.lastIndexOf('/')
      return {
        value: formatFileMention(path),
        label: slash < 0 ? path : path.slice(slash + 1),
        detail: slash < 0 ? undefined : path.slice(0, slash),
      }
    })
  })
  const showSuggestions = () =>
    focused() && !dismissed() && mention() != null
  const listLabel = () => mention()?.sigil === '/'
    ? 'Provider commands'
    : mention()?.sigil === '$' ? 'Provider skills' : 'Worktree files'
  const emptyText = () => mention()?.sigil === '/'
    ? 'No matching commands.'
    : mention()?.sigil === '$' ? 'No matching skills.' : 'No matching files.'

  // A textarea cannot colour part of its own value, so the coloured copy is a <pre> over it and the
  // textarea's own text is transparent. The two boxes have to agree on font, padding, wrapping and
  // line height or the glyphs drift apart, which is why managed-agents.css declares those once for
  // both. Above the cap the mirror is dropped and the textarea paints its own text again.
  let mirror: HTMLPreElement | undefined
  const highlighted = () => props.value.length <= MAX_HIGHLIGHT_LENGTH
  const segments = createMemo(() => composerSegments(props.value, names()))

  let textarea: HTMLTextAreaElement | undefined

  const putCaret = (at: number) => {
    textarea?.focus()
    textarea?.setSelectionRange(at, at)
  }

  const updateMention = (value: string, cursor: number | null) => {
    setDismissed(false)
    setMention(cursor == null ? null : activeMention(value, cursor))
    setSelected(0)
  }

  const choose = (suggestion: MentionSuggestion) => {
    const active = mention()
    if (!active) return
    const completed = completeMention(props.value, active, suggestion.value)
    props.onValue(completed.text)
    setMention(null)
    setDismissed(false)
    queueMicrotask(() => putCaret(completed.cursor))
  }

  createEffect(() => {
    const count = suggestions().length
    if (selected() >= count) setSelected(Math.max(0, count - 1))
  })

  // Arrow keys can walk past the bottom of a list that scrolls, and a highlight nobody can see reads
  // as no highlight at all: the next Enter then takes something the list is not showing.
  let list: HTMLUListElement | undefined
  createEffect(() => {
    // Both, not just the cursor: a fresh query rebuilds the rows under a cursor that may not have
    // moved, and the list would keep the scroll position the last query left it at.
    const [index] = [selected(), suggestions()]
    const row = list?.children[index]
    if (!list || !(row instanceof HTMLElement)) return
    list.scrollTop += scrollDeltaFor(list.getBoundingClientRect(), row.getBoundingClientRect())
  })

  return (
    <div class="agent-mention-input" classList={{ highlighted: highlighted() }}>
      {/* Hover-to-reveal, like the copy button on a code block, but with its own class: handing
          `copy-btn` to the Button primitive lets `.ui-btn` outrank it on padding and colour, which
          is what the adoption test calls a clash. The chord is the shell's own maximise chord, and
          it is not registered: a task-scoped binding never fires from inside a textarea, so the row
          in shortcut settings would rebind nothing. */}
      <Show when={props.onToggleExpanded}>
        <Button
          variant="bare"
          class="agent-composer-expand"
          aria-label={props.expanded ? 'Collapse the message box' : 'Expand the message box'}
          aria-pressed={props.expanded}
          {...tip(props.expanded ? 'Collapse' : 'Expand', { key: '⌘⇧↩' })}
          onClick={() => props.onToggleExpanded?.()}
        >
          <Icon name={props.expanded ? 'minimize-2' : 'maximize-2'} size={12} />
        </Button>
      </Show>
      <Show when={highlighted()}>
        {/* Hidden from the accessibility tree: the textarea already carries this text, and a screen
            reader meeting it twice would read the draft twice. The tooltip is a mouse affordance on
            a copy of text the keyboard reaches through the textarea itself. */}
        <pre ref={mirror} class="agent-mention-mirror" aria-hidden="true">
          <Index each={segments()}>
            {(segment) => (
              <Show when={segment().token} fallback={segment().text}>
                {(token) => (
                  <span
                    class={`agent-mention-token ${token().kind}`}
                    data-tip={token().kind === 'file'
                      ? undefined
                      : describe(token().kind as 'command' | 'skill', token().name)}
                    // The mirror sits over the textarea, so a token span would otherwise swallow the
                    // click that was meant to put the caret in the middle of a sentence.
                    onMouseDown={(event) => {
                      event.preventDefault()
                      putCaret(token().end)
                    }}
                  >
                    {segment().text}
                  </span>
                )}
              </Show>
            )}
          </Index>
        </pre>
      </Show>
      <Textarea
        ref={textarea}
        class="agent-composer-input"
        onScroll={(event) => {
          if (!mirror) return
          mirror.scrollTop = event.currentTarget.scrollTop
          mirror.scrollLeft = event.currentTarget.scrollLeft
        }}
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
          // The shell's own meta+shift+enter maximises the focused pane, and its dispatcher skips a
          // typing target for anything but a global binding, so the chord is unclaimed in here. Same
          // fingers, nearest meaning: the surface you are typing in grows.
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'Enter') {
            event.preventDefault()
            props.onToggleExpanded?.()
            return
          }
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
        {/* Only `@` waits on a fetch. A command or skill list arrived with the session, so its
            dropdown must not be held behind the worktree walk or told that files failed to load. */}
        <div class="agent-mention-suggestions" role="listbox" aria-label={listLabel()}>
          <Show when={mention()?.sigil !== '@' || !files.loading} fallback={<p class="muted">Loading files…</p>}>
            <Show
              when={mention()?.sigil !== '@' || !files.error}
              fallback={<Alert>Unable to load worktree files.</Alert>}
            >
              <Show
                when={suggestions().length}
                fallback={<p class="repo-picker-empty">{emptyText()}</p>}
              >
                {/* The row the context picker draws, so a skill's description gets the line it needs
                    instead of being squeezed onto the end of its name. */}
                <ul ref={list} class="repo-picker-list">
                  <For each={suggestions()}>
                    {(suggestion, index) => (
                      <PickerRow
                        label={suggestion.label}
                        description={suggestion.detail}
                        active={index() === selected()}
                        role="option"
                        onHover={() => setSelected(index())}
                        onMouseDown={(event) => event.preventDefault()}
                        onSelect={() => choose(suggestion)}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  )
}
