import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { PreviewBridge } from '../../../core/client/capabilities'

export function PreviewFindBar(props: { taskId: string; preview: PreviewBridge; scope: () => HTMLElement }) {
  let input: HTMLInputElement | undefined
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const [activeMatch, setActiveMatch] = createSignal(0)
  const [matches, setMatches] = createSignal(0)

  const resetCount = () => {
    setActiveMatch(0)
    setMatches(0)
  }

  const focusAndSelect = () => {
    queueMicrotask(() => {
      input?.focus()
      input?.select()
    })
  }

  const openFind = () => {
    setOpen(true)
    focusAndSelect()
  }

  const closeFind = (returnFocus: boolean) => {
    setOpen(false)
    props.preview.stopFind(props.taskId, 'keepSelection')
    if (returnFocus) props.preview.focus(props.taskId)
  }

  const findNext = (backward: boolean) => {
    if (query().length === 0) return
    props.preview.find(props.taskId, query(), backward ? 'backward' : 'forward')
  }

  createEffect(() => {
    if (!open()) return
    const text = query()
    resetCount()
    if (text.length === 0) props.preview.stopFind(props.taskId, 'clearSelection')
    else props.preview.find(props.taskId, text, 'initial')
  })

  onMount(() => {
    const offRequested = props.preview.onFindRequested((request) => {
      if (request.taskId === props.taskId) openFind()
    })
    const offResult = props.preview.onFindResult((result) => {
      if (result.taskId !== props.taskId) return
      setActiveMatch(result.activeMatchOrdinal)
      setMatches(result.matches)
    })
    const onKeyDown = (event: KeyboardEvent) => {
      const findChord = event.key.toLowerCase() === 'f'
        && (event.metaKey || event.ctrlKey)
        && !event.altKey
        && !event.shiftKey
      if (findChord) {
        if (!props.scope().contains(event.target as Node)) return
        event.preventDefault()
        openFind()
      } else if (open() && event.key === 'Escape') {
        event.preventDefault()
        closeFind(true)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown, true)
      offRequested()
      offResult()
      props.preview.stopFind(props.taskId, 'clearSelection')
    })
  })

  return (
    <Show when={open()}>
      <div class="preview-find-bar" role="search" aria-label="Find in preview page">
        <input
          ref={input}
          class="preview-find-input"
          type="text"
          aria-label="Find in preview page"
          autocomplete="off"
          spellcheck={false}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            findNext(event.shiftKey)
          }}
        />
        <span class="preview-find-count" aria-live="polite">
          {matches() > 0 ? `${activeMatch()} / ${matches()}` : '0 / 0'}
        </span>
        <button type="button" class="preview-find-btn" title="Previous match (Shift+Enter)" aria-label="Previous match" disabled={query().length === 0} onClick={() => findNext(true)}>↑</button>
        <button type="button" class="preview-find-btn" title="Next match (Enter)" aria-label="Next match" disabled={query().length === 0} onClick={() => findNext(false)}>↓</button>
        <button type="button" class="preview-find-btn" title="Close find (Escape)" aria-label="Close find" onClick={() => closeFind(true)}>×</button>
      </div>
    </Show>
  )
}
