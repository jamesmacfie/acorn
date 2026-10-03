import { useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { activeNodeId, queryOwner, debounce } from '@acorn/plugin-api/client'
import { Alert, CopyButton, EmptyState, Input, Row, Rows, SectionHeader, Stack, TabPanel, Text, ToggleButton, Toolbar } from '@acorn/plugin-api/ui'
import { requestEditorReveal } from '../editorState'
import { findInFiles, type SearchHit } from './searchClient'

// Find-in-files panel: substring search by default, with case, whole-word, and regex toggles.
// Double-clicking a hit opens the file in the editor beside it, centered on the match. For why this
// is a sidebar panel rather than its own pane, and why it stays mounted when hidden, see
// docs/panes/contributions.md § Contributions.
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

  const queryClient = useQueryClient()
  const registeredNode = queryOwner(queryClient)
  const nodeId = registeredNode === undefined ? activeNodeId() : registeredNode
  const [results, setResults] = createSignal<Awaited<ReturnType<typeof findInFiles>>>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal('')
  let disposed = false
  let generation = 0
  let controller: AbortController | undefined
  createEffect(() => {
    const taskId = props.taskId
    const input = query()
    const q = debounced().trim()
    const opts = { caseSensitive: caseSensitive(), wholeWord: wholeWord(), regex: regex() }
    const revision = ++generation
    controller?.abort()
    controller = undefined
    setLoading(false)
    setError('')
    if (!q || input.trim() !== q) {
      if (!input.trim()) setResults(undefined)
      return
    }
    const owned = new AbortController()
    controller = owned
    setLoading(true)
    void findInFiles(taskId, q, opts, { nodeId, signal: owned.signal }).then((result) => {
      if (!disposed && revision === generation) setResults(result)
    }).catch((cause: unknown) => {
      if (!disposed && revision === generation && !owned.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Search failed.')
    }).finally(() => {
      if (!disposed && revision === generation) setLoading(false)
    })
  })
  onCleanup(() => {
    disposed = true
    generation++
    pushDebounced.cancel()
    controller?.abort()
  })

  const files = () => results()?.files ?? []
  const totalHits = createMemo(() => files().reduce((n, f) => n + f.hits.length, 0))

  // The retained pane intent rather than a callback prop. See docs/panes/contributions.md § Contributions.
  function openHit(path: string, hit: SearchHit) {
    requestEditorReveal(props.taskId, path, hit.line, hit.col)
  }

  // Focus the box whenever the sidebar flips to Search, including when the retained `editor:search`
  // intent does the flipping (docs/panes/contributions.md § Contributions). Deferred to a microtask because
  // `TabPanel` keeps the panel hidden until the same render that sets `active`, and a hidden input
  // cannot take focus.
  let input: HTMLInputElement | undefined
  createEffect(on(() => props.active, (active) => {
    if (active) queueMicrotask(() => { if (!disposed && props.active) input?.focus() })
  }))

  const status = () => {
    if (!debounced().trim()) return "Type to search this task's files."
    if (error()) return error()
    if (loading()) return 'Searching…'
    const hits = `${totalHits()} result${totalHits() === 1 ? '' : 's'}`
    const where = `${files().length} file${files().length === 1 ? '' : 's'}`
    return `${hits} in ${where}`
  }

  return (
    <TabPanel idPrefix="editor-side" id="search" active={props.active ? 'search' : 'files'}>
      {/* Stacked, not a row: the sidebar is narrow, and an input sharing it with three toggles
          leaves about a hundred pixels to type a query into. Two sm strips, so both sit on the pane's
          inset, and the count rides at the end of the toggles. */}
      <Toolbar size="sm" ariaLabel="Search">
        <Input
          ref={input}
          kind="filter"
          size="sm"
          label="Search in files"
          placeholder="Search in files…"
          value={query()}
          assist={false}
          onInput={(value) => onInput(value)}
        />
      </Toolbar>
      <Toolbar size="sm" ariaLabel="Search options">
        {/* Three independent booleans, so three ToggleButtons, not a radiogroup, which would make
            them mutually exclusive. The find bar's shape. */}
        <ToggleButton variant="bare" size="sm" tip="Match case" pressed={caseSensitive()} onPressedChange={setCaseSensitive}>Aa</ToggleButton>
        <ToggleButton variant="bare" size="sm" tip="Whole word" pressed={wholeWord()} onPressedChange={setWholeWord}>\b</ToggleButton>
        <ToggleButton variant="bare" size="sm" tip="Use regular expression" pressed={regex()} onPressedChange={setRegex}>.*</ToggleButton>
        <Show when={files().length}>
          <Toolbar.Spacer />
          <Text emphasis="muted">{status()}</Text>
        </Show>
      </Toolbar>

      <Show when={files().length} fallback={<EmptyState busy={loading()} size="sm" align="start">{status()}</EmptyState>}>
        {/* One collection per file rather than one for the whole result set: a hit's key has to be
            stable across a refetch, and `path:line:col` is the only thing about a hit that is. */}
        <Stack gap="none">
          {/* The client never learns the node's cap, so this cannot say how many it kept. */}
          <Show when={results()?.truncated}>
            <Alert variant="banner" tone="muted">Showing the first results. Narrow your search to see more.</Alert>
          </Show>
          {files().map((file) => (
            <Stack gap="none">
              {/* `sub`, because a path is content and keeps its case. It still sticks, so the file a hit
                  belongs to stays in view while its hits scroll. */}
              <SectionHeader
                level="sub"
                sticky
                count={file.hits.length}
                actions={<CopyButton text={() => file.path} title="Copy file path" />}
              >
                {file.path}
              </SectionHeader>
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
            </Stack>
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
