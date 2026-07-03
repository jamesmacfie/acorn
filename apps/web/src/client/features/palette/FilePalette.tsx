import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { editorApi } from '../editor/editorClient'
import { editorOpen } from '../editor/editorState'
import { activeTaskId, dispatchActiveLayout } from '../tasks/tasks'
import { fuzzyScore } from './model'
import './palette.css'

// ⌘P quick-open: fuzzy-jump to a file in the active task's worktree. Monaco has no built-in file
// finder (that's a VS Code workbench feature, not the editor core), so this reuses OUR command-
// palette shell (palette.css + fuzzyScore) over `git ls-files`. Selecting a file opens an ephemeral
// tab via shared editorState and reveals the editor pane — EditorPane's active() effect swaps it in.
const MAX_ROWS = 100 // ponytail: big repos have thousands of files; cap the render, raise if it bites

export default function FilePalette() {
  const api = editorApi()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const [sel, setSel] = createSignal(0)
  let inputRef: HTMLInputElement | undefined

  const [files] = createResource(
    () => (open() ? activeTaskId() : null),
    async (id) => (id && api ? await api.files(id) : []),
  )

  const matches = createMemo<string[]>(() => {
    const all = files() ?? []
    const q = query().trim()
    if (!q) return all.slice(0, MAX_ROWS)
    return all
      .map((path) => ({ path, score: fuzzyScore(q, path) }))
      .filter((x): x is { path: string; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ROWS)
      .map((x) => x.path)
  })

  const close = () => {
    setOpen(false)
    setQuery('')
    setSel(0)
  }

  function pick(path: string) {
    const taskId = activeTaskId()
    close()
    if (!taskId) return
    dispatchActiveLayout({ type: 'show', pane: 'editor' })
    editorOpen(taskId, path, true) // ephemeral preview tab, like a single tree click
  }

  const onKey = (e: KeyboardEvent) => {
    // Monaco binds no ⌘P, so the keydown reaches window; preventDefault blocks the browser print dialog.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
      if (!activeTaskId()) return
      e.preventDefault()
      if (open()) close()
      else {
        setOpen(true)
        queueMicrotask(() => inputRef?.focus())
      }
      return
    }
    if (!open()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, matches().length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const path = matches()[sel()]
      if (path) pick(path)
    }
  }

  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  return (
    <Show when={open()}>
      <div class="overlay-backdrop" onClick={close}>
        <div class="overlay palette" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            class="palette-input"
            placeholder="Go to file…"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value)
              setSel(0)
            }}
          />
          <ul class="palette-list">
            <For each={matches()} fallback={<li class="palette-empty muted">No files.</li>}>
              {(path, i) => {
                const slash = path.lastIndexOf('/')
                const name = slash >= 0 ? path.slice(slash + 1) : path
                const dir = slash >= 0 ? path.slice(0, slash) : ''
                return (
                  <li>
                    <button
                      type="button"
                      class="palette-row"
                      classList={{ selected: i() === sel() }}
                      onMouseEnter={() => setSel(i())}
                      onClick={() => pick(path)}
                    >
                      <span class="palette-label">{name}</span>
                      <Show when={dir}>
                        <span class="palette-hint muted">{dir}</span>
                      </Show>
                    </button>
                  </li>
                )
              }}
            </For>
          </ul>
        </div>
      </div>
    </Show>
  )
}
