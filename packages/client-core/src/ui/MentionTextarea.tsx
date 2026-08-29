import { createEffect, createMemo, createSignal, For, Index, Show, type JSX } from 'solid-js'
import { activeMention, completeMention, scrollDeltaFor, type ActiveMention } from './mentions'
import { Alert, Textarea } from './primitives'
import PickerRow from './PickerRow'
import type { Tone } from './kit/tokens'

// A textarea that completes what is typed after a sigil, and colours what it has completed.
//
// One node for three fields that had grown apart: the diff viewer's `@login` box, github's comment
// composer, and the agents composer's `@file` / `/command` / `$skill` draft, which was the only one
// with a coloured mirror and was the only one that lived in a plugin — with the stylesheet the two
// boxes need in order to agree on where a glyph sits (docs/future/layout/phase-8-agents.md).
//
// What crosses is data: sources say what may be completed after which sigil, and `segments` says
// which runs of the text are already a mention and what tone to draw them in. Neither is a DOM
// concern, so a terminal host draws the same field from the same props.

/** One row of the list. `value` is the text that replaces the mention under the caret. */
export type MentionSuggestion = { value: string; label: string; detail?: string }

/** What may be completed after one sigil. */
export type MentionSource = {
  sigil: string
  /** The list's accessible name: "Worktree files", "Provider commands". */
  label: string
  emptyText: string
  /** Still being fetched. Only a source that reaches a route ever sets it, and a source that arrived
   *  with the session must not be held behind one that has not (the file walk is the slow one). */
  loading?: boolean
  /** Why there is nothing to offer, when the reason is worth saying out loud. */
  error?: string
  suggest: (query: string) => readonly MentionSuggestion[]
}

/** A run of the draft, as the mirror draws it. A segment with no `tone` is prose. */
export type MentionSegment = {
  text: string
  tone?: Tone
  /** The long form of what this token names, on hover. */
  tip?: string
  /** Where a click on this run puts the caret. The mirror sits over the field, so without it a
   *  coloured span would swallow the click meant to land in the middle of a sentence. */
  caret?: number
}

export default function MentionTextarea(props: {
  value: string
  onInput: (value: string) => void
  /** Completions after `@`, as bare names. The short form of `sources`, for a field that offers one
   *  list of logins and nothing else. */
  mentions?: readonly string[]
  sources?: readonly MentionSource[]
  /** The coloured copy drawn behind the text. `null` draws none, which is what a draft too long to
   *  tokenise wants: the field paints its own text again. */
  segments?: (value: string) => readonly MentionSegment[] | null
  placeholder?: string
  disabled?: boolean
  label?: string
  rows?: number
  /** Enter without a modifier. Absent leaves Enter as a newline. */
  onSubmit?: () => void
  /** Escape, when the list is closed. Absent leaves Escape to whatever is outside the field. */
  onCancel?: () => void
  /** Files pasted or dropped onto the field. */
  onFiles?: (files: File[]) => void
  onKeyDown?: (event: KeyboardEvent) => void
  /** Drawn inside the field's box, before the text: the agents composer's expand toggle. */
  overlay?: JSX.Element
  ref?: HTMLTextAreaElement | ((element: HTMLTextAreaElement) => void)
}) {
  const sources = createMemo<readonly MentionSource[]>(() => props.sources ?? (props.mentions
    ? [{
        sigil: '@',
        label: 'Mentions',
        emptyText: 'No matching names.',
        suggest: (query: string) => (props.mentions ?? [])
          .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8)
          .map((name) => ({ value: `@${name}`, label: name })),
      }]
    : []))
  const sigils = createMemo(() => sources().map((source) => source.sigil))

  const [mention, setMention] = createSignal<ActiveMention | null>(null)
  const [focused, setFocused] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [selected, setSelected] = createSignal(0)

  const source = () => sources().find((candidate) => candidate.sigil === mention()?.sigil)
  const suggestions = createMemo<readonly MentionSuggestion[]>(() => {
    const active = mention()
    const found = source()
    return active && found ? found.suggest(active.query) : []
  })
  const open = () => focused() && !dismissed() && mention() != null

  let field: HTMLTextAreaElement | undefined
  let mirror: HTMLPreElement | undefined
  const segments = createMemo(() => props.segments?.(props.value) ?? null)

  const putCaret = (at: number) => {
    field?.focus()
    field?.setSelectionRange(at, at)
  }
  const update = (value: string, cursor: number | null) => {
    setDismissed(false)
    setMention(cursor == null ? null : activeMention(value, cursor, sigils()))
    setSelected(0)
  }
  /** Re-read the caret from the field itself. The kit hands a caller the text, not the event, so
   *  where the caret is comes from the element this component already holds. */
  const sync = () => update(field?.value ?? '', field?.selectionStart ?? null)

  const choose = (suggestion: MentionSuggestion) => {
    const active = mention()
    if (!active) return
    const completed = completeMention(props.value, active, suggestion.value)
    props.onInput(completed.text)
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
    <div class="ui-mentionfield" data-mirrored={segments() ? '' : undefined}>
      <Show when={props.overlay}>{props.overlay}</Show>
      <Show when={segments()}>
        {(runs) => (
          // Hidden from the accessibility tree: the textarea already carries this text, and a screen
          // reader meeting it twice would read the draft twice.
          <pre ref={mirror} class="ui-mentionfield-mirror" aria-hidden="true">
            <Index each={runs()}>
              {(run) => (
                <Show when={run().tone} fallback={run().text}>
                  {(tone) => (
                    <span
                      class="ui-mentionfield-token"
                      data-tone={tone()}
                      data-tip={run().tip}
                      onMouseDown={(event) => {
                        if (run().caret == null) return
                        event.preventDefault()
                        putCaret(run().caret!)
                      }}
                    >
                      {run().text}
                    </span>
                  )}
                </Show>
              )}
            </Index>
          </pre>
        )}
      </Show>
      <Textarea
        ref={(element) => {
          field = element
          ;(props.ref as ((element: HTMLTextAreaElement) => void) | undefined)?.(element)
        }}
        value={props.value}
        disabled={props.disabled}
        label={props.label}
        placeholder={props.placeholder}
        rows={props.rows ?? 3}
        onScroll={() => {
          if (!mirror || !field) return
          mirror.scrollTop = field.scrollTop
          mirror.scrollLeft = field.scrollLeft
        }}
        onFocus={() => {
          setFocused(true)
          sync()
        }}
        onBlur={() => setFocused(false)}
        onPress={sync}
        onInput={(value) => {
          props.onInput(value)
          update(value, field?.selectionStart ?? value.length)
        }}
        onPaste={(event) => {
          const pasted = [...(event.clipboardData?.files ?? [])]
          if (!pasted.length || !props.onFiles) return
          event.preventDefault()
          props.onFiles(pasted)
        }}
        onDragOver={(event) => {
          if (props.onFiles && event.dataTransfer?.types.includes('Files')) event.preventDefault()
        }}
        onDrop={(event) => {
          const dropped = [...(event.dataTransfer?.files ?? [])]
          if (!dropped.length || !props.onFiles) return
          event.preventDefault()
          props.onFiles(dropped)
        }}
        onKeyUp={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return
          sync()
        }}
        onKeyDown={(event) => {
          if (event.isComposing) return
          props.onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (open()) {
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
              choose(suggestions()[selected()]!)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDismissed(true)
              return
            }
          }
          // One key, innermost thing first: the list above closes before Escape reaches whatever the
          // caller does with it. With no `onCancel` it stays unclaimed, and because the overlay
          // listener stands down on `defaultPrevented` (./dismissable.ts), an un-prevented Escape
          // still closes a modal the field happens to be sitting inside.
          if (event.key === 'Escape' && props.onCancel) {
            event.preventDefault()
            props.onCancel()
            return
          }
          if (event.key === 'Enter' && !event.shiftKey && props.onSubmit) {
            event.preventDefault()
            props.onSubmit()
          }
        }}
      />
      <Show when={open()}>
        {/* Only a source that fetches waits. A list that arrived with the session must not be held
            behind one that has not, or told that somebody else's fetch failed. */}
        <div class="ui-mentionfield-list" role="listbox" aria-label={source()?.label}>
          <Show when={!source()?.loading} fallback={<p class="repo-picker-empty">Loading…</p>}>
            <Show when={!source()?.error} fallback={<Alert>{source()?.error}</Alert>}>
              <Show
                when={suggestions().length}
                fallback={<p class="repo-picker-empty">{source()?.emptyText}</p>}
              >
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
