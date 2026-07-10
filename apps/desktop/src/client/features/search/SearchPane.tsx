import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { Task } from '../../queries'
import { debounce } from '../../autosave'
import { editorOpen, requestEditorReveal } from '../editor/editorState'
import { findInFiles, type SearchHit } from './searchClient'
import './search.css'

// Find-in-files pane (docs/panes.md): project-wide text search over the task's worktree via
// ripgrep (search:findInFiles IPC). Substring by default, with case / whole-word / regex toggles.
// Clicking a hit opens the file in the Editor pane (beside this one) scrolled to the match line —
// editorOpen swaps the tab, requestEditorReveal tells EditorPane which line to reveal.
export default function SearchPane(props: { task: Task }) {
  const [query, setQuery] = createSignal('')
  const [debounced, setDebounced] = createSignal('')
  const [caseSensitive, setCaseSensitive] = createSignal(false)
  const [wholeWord, setWholeWord] = createSignal(false)
  const [regex, setRegex] = createSignal(false)

  // Debounce keystrokes so we don't spawn ripgrep per character; toggles apply immediately (they're
  // part of the resource source, not debounced).
  const pushDebounced = debounce((q: string) => setDebounced(q), 200)
  const onInput = (v: string) => {
    setQuery(v)
    pushDebounced(v)
  }

  const [results] = createResource(
    () => {
      const q = debounced().trim()
      if (!q) return null
      return { taskId: props.task.id, q, opts: { caseSensitive: caseSensitive(), wholeWord: wholeWord(), regex: regex() } }
    },
    (src) => findInFiles(src.taskId, src.q, src.opts),
  )

  const totalHits = createMemo(() => (results()?.files ?? []).reduce((n, f) => n + f.hits.length, 0))

  function openHit(path: string, line: number) {
    editorOpen(props.task.id, path, true) // ephemeral preview tab, like a tree click
    requestEditorReveal(props.task.id, path, line)
  }

  return (
    <section class="pane search-pane">
      <div class="search-bar">
        <input
          class="search-input"
          placeholder="Search in files…"
          value={query()}
          spellcheck={false}
          autocapitalize="off"
          autocorrect="off"
          onInput={(e) => onInput(e.currentTarget.value)}
        />
        <div class="search-toggles">
          <button type="button" class="search-toggle" classList={{ active: caseSensitive() }} title="Match case" aria-pressed={caseSensitive()} onClick={() => setCaseSensitive((v) => !v)}>Aa</button>
          <button type="button" class="search-toggle" classList={{ active: wholeWord() }} title="Whole word" aria-pressed={wholeWord()} onClick={() => setWholeWord((v) => !v)}>\b</button>
          <button type="button" class="search-toggle" classList={{ active: regex() }} title="Use regular expression" aria-pressed={regex()} onClick={() => setRegex((v) => !v)}>.*</button>
        </div>
      </div>

      <div class="search-status muted">
        <Show when={debounced().trim()} fallback={<span>Type to search the worktree.</span>}>
          <Show when={!results.loading} fallback={<span>Searching…</span>}>
            <span>{totalHits()} result{totalHits() === 1 ? '' : 's'} in {results()?.files.length ?? 0} file{(results()?.files.length ?? 0) === 1 ? '' : 's'}</span>
            <Show when={results()?.truncated}><span class="search-truncated"> · results truncated</span></Show>
          </Show>
        </Show>
      </div>

      <div class="search-results">
        <For each={results()?.files ?? []}>
          {(file) => (
            <div class="search-file">
              <div class="search-file-head" title={file.path}>
                <span class="search-file-path">{file.path}</span>
                <span class="search-file-count muted">{file.hits.length}</span>
              </div>
              {/* ponytail: render every hit; the backend caps totals at 2000, so no per-file cap yet. */}
              <For each={file.hits}>
                {(hit) => (
                  <button type="button" class="search-hit" onClick={() => openHit(file.path, hit.line)}>
                    <span class="search-hit-line muted">{hit.line}</span>
                    <span class="search-hit-preview"><HitPreview hit={hit} /></span>
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </section>
  )
}

// Split the preview line around the matched span so it can be highlighted. col/endCol are 1-based
// columns; for ASCII they equal string indices (see shared/search.ts ponytail note).
function HitPreview(props: { hit: SearchHit }) {
  const parts = createMemo(() => {
    const { preview, col, endCol } = props.hit
    const start = Math.max(0, col - 1)
    const end = Math.max(start, endCol - 1)
    return { before: preview.slice(0, start), match: preview.slice(start, end), after: preview.slice(end) }
  })
  return (
    <>
      {parts().before}
      <mark class="search-mark">{parts().match}</mark>
      {parts().after}
    </>
  )
}
