import { createMemo, createResource, For, Show } from 'solid-js'
import { editorApi } from '../editor/editorClient'
import { editorOpen } from '../editor/editorState'
import { activeTaskId, dispatchActiveLayout } from '../tasks/tasks'
import { fuzzyScore } from './model'
import { createOverlayPalette } from './overlay'
import './palette.css'

// ⌘P quick-open: fuzzy-jump to a file in the active task's worktree. Monaco has no built-in file
// finder (that's a VS Code workbench feature, not the editor core), so this reuses OUR command-
// palette shell (palette.css + fuzzyScore + createOverlayPalette) over `git ls-files`. Selecting a
// file opens an ephemeral tab via shared editorState and reveals the editor pane — EditorPane's
// active() effect swaps it in.
const MAX_ROWS = 100 // ponytail: big repos have thousands of files; cap the render, raise if it bites

export default function FilePalette() {
  const api = editorApi()

  const palette = createOverlayPalette({
    count: () => matches().length,
    onPick: (index) => {
      const path = matches()[index]
      if (path) pick(path)
    },
    // Monaco binds no ⌘P, so the keydown reaches window; preventDefault blocks the browser print
    // dialog. A no-op (no consume) with no active task.
    isToggle: (e) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p' && !!activeTaskId(),
  })

  const [files] = createResource(
    () => (palette.open() ? activeTaskId() : null),
    async (id) => (id && api ? await api.files(id) : []),
  )

  const matches = createMemo<string[]>(() => {
    const all = files() ?? []
    const q = palette.query().trim()
    if (!q) return all.slice(0, MAX_ROWS)
    return all
      .map((path) => ({ path, score: fuzzyScore(q, path) }))
      .filter((x): x is { path: string; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ROWS)
      .map((x) => x.path)
  })

  function pick(path: string) {
    const taskId = activeTaskId()
    palette.close()
    if (!taskId) return
    dispatchActiveLayout({ type: 'show', pane: 'editor' })
    editorOpen(taskId, path, true) // ephemeral preview tab, like a single tree click
  }

  return (
    <Show when={palette.open()}>
      <div class="overlay-backdrop" onClick={palette.close}>
        <div class="overlay palette" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <input
            ref={palette.setInputRef}
            class="palette-input"
            placeholder="Go to file…"
            value={palette.query()}
            onInput={(e) => palette.setQuery(e.currentTarget.value)}
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
                      classList={{ selected: i() === palette.sel() }}
                      onMouseEnter={() => palette.setSel(i())}
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
