import { createEffect, createMemo, createResource, createSignal, For, on, Show } from 'solid-js'
import { debounce } from '@acorn/plugin-api/client'
import { CopyButton, Input, ToggleButton, Toolbar } from '@acorn/plugin-api/ui'
import { requestEditorReveal } from '../editorState'
import { findInFiles, type SearchHit } from './searchClient'
import './search.css'

// Find-in-files (docs/panes.md): project-wide text search over the task's worktree via ripgrep.
// Substring by default, with case / whole-word / regex toggles. Double-clicking a hit opens the file
// in the editor beside it, centered on the match.
//
// A PANEL in the editor pane's sidebar rather than a pane of its own, the way VS Code's sidebar works:
// one surface for one mental model ("find something in this project, open it"), and a result click is
// now a selection inside the pane that already owns the file tree and tabs.
//
// HIDDEN, not unmounted, when the sidebar is showing the tree — a query and its results survive
// flipping to Files and back, which is the whole reason the sidebar is a toggle and not a router.
export default function SearchPanel(props: { taskId: string; active: boolean }) {
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
      return { taskId: props.taskId, q, opts: { caseSensitive: caseSensitive(), wholeWord: wholeWord(), regex: regex() } }
    },
    (src) => findInFiles(src.taskId, src.q, src.opts),
  )

  const totalHits = createMemo(() => (results()?.files ?? []).reduce((n, f) => n + f.hits.length, 0))

  // Still the retained pane intent, not a callback prop, even though the editor is now this panel's own
  // pane: the reveal path is one code path whether the request came from here or from another pane, and
  // the panel does not have to know how the pane it lives in swaps Monaco models.
  function openHit(path: string, hit: SearchHit) {
    requestEditorReveal(props.taskId, path, hit.line, hit.col)
  }

  // Focus the box when the sidebar flips to Search — including when ⌘⇧F did the flipping, which is the
  // entry point that replaced the old pane's chord. A microtask, because the panel is display:none until
  // the same render that sets `active` and a hidden input cannot take focus.
  let input: HTMLInputElement | undefined
  createEffect(on(() => props.active, (active) => {
    if (active) queueMicrotask(() => input?.focus())
  }))

  return (
    <div
      id="editor-side-panel-search"
      role="tabpanel"
      aria-labelledby="editor-side-tab-search"
      class="search-panel"
      style={{ display: props.active ? undefined : 'none' }}
    >
      <div class="search-bar">
        <Input
          ref={input}
          class="search-input"
          kind="filter"
          placeholder="Search in files…"
          value={query()}
          spellcheck={false}
          autocapitalize="off"
          autocorrect="off"
          onInput={(e) => onInput(e.currentTarget.value)}
        />
        <Toolbar.Group class="search-toggles">
          {/* Three independent booleans, so three ToggleButtons — not a radiogroup, which would make
              them mutually exclusive. */}
          <ToggleButton variant="bare" size="sm" class="search-toggle" title="Match case" pressed={caseSensitive()} onPressedChange={setCaseSensitive}>Aa</ToggleButton>
          <ToggleButton variant="bare" size="sm" class="search-toggle" title="Whole word" pressed={wholeWord()} onPressedChange={setWholeWord}>\b</ToggleButton>
          <ToggleButton variant="bare" size="sm" class="search-toggle" title="Use regular expression" pressed={regex()} onPressedChange={setRegex}>.*</ToggleButton>
        </Toolbar.Group>
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
              <div class="search-file-head copyable" title={file.path}>
                <span class="search-file-path">{file.path}</span>
                <CopyButton text={() => file.path} title="Copy file path" />
                <span class="search-file-count muted">{file.hits.length}</span>
              </div>
              {/* Render every returned hit; the backend caps the total result set. */}
              <For each={file.hits}>
                {(hit) => (
                  <button
                    type="button"
                    class="search-hit"
                    title={`Open ${file.path} at ${hit.line}:${hit.col}`}
                    onClick={(event) => {
                      // Native keyboard/assistive button activation has detail 0. Mouse clicks wait
                      // for the explicit double-click below so inspecting results does not navigate.
                      if (event.detail === 0) openHit(file.path, hit)
                    }}
                    onDblClick={() => openHit(file.path, hit)}
                  >
                    <span class="search-hit-line muted">{hit.line}</span>
                    <span class="truncate"><HitPreview hit={hit} /></span>
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

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
      <mark class="ui-find-mark">{parts().match}</mark>
      {parts().after}
    </>
  )
}
