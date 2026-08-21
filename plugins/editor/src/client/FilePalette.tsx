import { createMemo, createResource, Show } from 'solid-js'
import { editorApi } from './editorClient'
import { editorOpen } from './editorState'
import { activeTaskId, createOverlayPalette, dispatchActiveLayout, fuzzyScore } from '@acorn/plugin-api/client'
import { PaletteSurface } from '@acorn/plugin-api/ui/host'

// ⌘P quick-open: fuzzy-jump to a file in the active task's worktree. Monaco has no built-in file
// finder (that is a VS Code workbench feature, not part of the editor core), so this reuses the
// app's own command-palette shell (PaletteSurface, fuzzyScore, createOverlayPalette) over
// `git ls-files`. Selecting a file opens an ephemeral tab through editorState and reveals the
// editor pane, where EditorPane's active() effect swaps it in.
const MAX_ROWS = 100 // Keep palette rendering bounded for repositories with thousands of files.

export default function FilePalette() {
  const api = editorApi()

  const palette = createOverlayPalette({
    id: 'files',
    title: 'Go to file',
    toggleChord: 'meta+p',
    active: () => !!activeTaskId(),
    count: () => matches().length,
    onPick: (index) => {
      const path = matches()[index]
      if (path) pick(path)
    },
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
    <PaletteSurface
      palette={palette}
      items={matches()}
      ariaLabel="Go to file"
      placeholder="Go to file…"
      emptyText="No files."
      onPick={(path) => pick(path)}
      row={(path) => {
        const slash = path.lastIndexOf('/')
        return (
          <>
            <span class="palette-label">{slash >= 0 ? path.slice(slash + 1) : path}</span>
            <Show when={slash >= 0}>
              <span class="palette-hint muted">{path.slice(0, slash)}</span>
            </Show>
          </>
        )
      }}
    />
  )
}
