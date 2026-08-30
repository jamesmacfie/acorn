import { createEffect, createMemo, createResource, createSignal, on, Show } from 'solid-js'
import { debounce } from '@acorn/plugin-api/client'
import { CopyButton, EmptyState, Input, Row, Rows, Section, Stack, TabPanel, Text, ToggleButton, Toolbar } from '@acorn/plugin-api/ui'
import { requestEditorReveal } from '../editorState'
import { findInFiles, type SearchHit } from './searchClient'

// Find-in-files panel: substring search by default, with case, whole-word, and regex toggles.
// Double-clicking a hit opens the file in the editor beside it, centered on the match. For why this
// is a sidebar panel rather than its own pane, and why it stays mounted when hidden, see
// docs/panes.md § Contributions.
//
// Entirely kit nodes since phase 9 of the layout programme, and its stylesheet went with them. Two
// things came back for free in the trade: the results are a `Rows` collection, so arrow keys, Home,
// End, the page keys and type-ahead work in a list that had none of them, and `TabPanel` owns the
// hidden-but-mounted half that the panel used to spell as an inline `display: none`.
export default function SearchPanel(props: { taskId: string; active: boolean }) {
  const [query, setQuery] = createSignal('')
  const [debounced, setDebounced] = createSignal('')
  const [caseSensitive, setCaseSensitive] = createSignal(false)
  const [wholeWord, setWholeWord] = createSignal(false)
  const [regex, setRegex] = createSignal(false)

  // Debounces keystrokes so ripgrep does not spawn per character; toggles apply immediately since
  // they are part of the resource source, not debounced.
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

  const files = () => results()?.files ?? []
  const totalHits = createMemo(() => files().reduce((n, f) => n + f.hits.length, 0))

  // The retained pane intent rather than a callback prop. See docs/panes.md § Contributions.
  function openHit(path: string, hit: SearchHit) {
    requestEditorReveal(props.taskId, path, hit.line, hit.col)
  }

  // Focus the box whenever the sidebar flips to Search, including when the retained `editor:search`
  // intent does the flipping (docs/panes.md § Contributions). Deferred to a microtask because
  // `TabPanel` keeps the panel hidden until the same render that sets `active`, and a hidden input
  // cannot take focus.
  let input: HTMLInputElement | undefined
  createEffect(on(() => props.active, (active) => {
    if (active) queueMicrotask(() => input?.focus())
  }))

  const status = () => {
    if (!debounced().trim()) return 'Type to search the worktree.'
    if (results.loading) return 'Searching…'
    const hits = `${totalHits()} result${totalHits() === 1 ? '' : 's'}`
    const where = `${files().length} file${files().length === 1 ? '' : 's'}`
    return `${hits} in ${where}${results()?.truncated ? ' · results truncated' : ''}`
  }

  return (
    <TabPanel idPrefix="editor-side" id="search" active={props.active ? 'search' : 'files'}>
      {/* Stacked, not a row: the sidebar is narrow, and an input sharing it with three toggles
          leaves about a hundred pixels to type a query into. */}
      <Stack gap="row">
        <Input
          ref={input}
          kind="filter"
          placeholder="Search in files…"
          value={query()}
          assist={false}
          onInput={(value) => onInput(value)}
        />
        <Toolbar.Group>
          {/* Three independent booleans, so three ToggleButtons, not a radiogroup, which would make
              them mutually exclusive. */}
          <ToggleButton variant="bare" size="sm" title="Match case" pressed={caseSensitive()} onPressedChange={setCaseSensitive}>Aa</ToggleButton>
          <ToggleButton variant="bare" size="sm" title="Whole word" pressed={wholeWord()} onPressedChange={setWholeWord}>\b</ToggleButton>
          <ToggleButton variant="bare" size="sm" title="Use regular expression" pressed={regex()} onPressedChange={setRegex}>.*</ToggleButton>
        </Toolbar.Group>
      </Stack>

      <Show when={files().length} fallback={<EmptyState busy={results.loading} size="sm" align="start">{status()}</EmptyState>}>
        {/* One collection per file rather than one for the whole result set: a hit's key has to be
            stable across a refetch, and `path:line:col` is the only thing about a hit that is. */}
        <Stack gap="stack">
          <Text emphasis="muted">{status()}</Text>
          {files().map((file) => (
            <Section
              label={file.path}
              count={file.hits.length}
              sticky
              actions={<CopyButton text={() => file.path} title="Copy file path" />}
            >
              {/* Every returned hit; the node caps the total result set. */}
              <Rows
                id={`editor.search:${file.path}`}
                ariaLabel={`Matches in ${file.path}`}
                items={file.hits.map((hit) => ({ key: `${hit.line}:${hit.col}`, label: String(hit.line), hit }))}
                onActivate={(key) => {
                  const hit = file.hits.find((candidate) => `${candidate.line}:${candidate.col}` === key)
                  if (hit) openHit(file.path, hit)
                }}
              >
                {(item, itemProps) => (
                  <Row
                    item={itemProps}
                    density="compact"
                    title={`Open ${file.path} at ${item.hit.line}:${item.hit.col}`}
                    leading={<Text emphasis="mono">{String(item.hit.line)}</Text>}
                    onPress={() => openHit(file.path, item.hit)}
                  >
                    <HitPreview hit={item.hit} />
                  </Row>
                )}
              </Rows>
            </Section>
          ))}
        </Stack>
      </Show>
    </TabPanel>
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
    <Text emphasis="mono">
      {parts().before}
      <Text emphasis="match">{parts().match}</Text>
      {parts().after}
    </Text>
  )
}
