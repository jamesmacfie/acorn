import { useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { activeNodeId, queryOwner, debounce, latestSignal } from '@acorn/plugin-api/client'
import { Alert, CopyButton, EmptyState, IconButton, Input, Row, Rows, SectionHeader, Stack, TabPanel, Text, FilterBar, Toolbar } from '@acorn/plugin-api/ui'
import { requestEditorReveal } from '../editorState'
import { findInFiles, type SearchHit } from './searchClient'
import { taskSearchState, updateTaskSearchState } from './searchState'

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
  const queryClient = useQueryClient()
  const registeredNode = queryOwner(queryClient)
  const nodeId = registeredNode === undefined ? activeNodeId() : registeredNode
  const state = () => taskSearchState(props.taskId, nodeId)
  const change = (update: Parameters<typeof updateTaskSearchState>[1]) => updateTaskSearchState(props.taskId, update, nodeId)
  const [debounced, setDebounced] = createSignal(state().query)
  const [debouncedFolder, setDebouncedFolder] = createSignal(state().opts.folder)
  const [filterRevision, setFilterRevision] = createSignal(0)
  const [debouncedFilterRevision, setDebouncedFilterRevision] = createSignal(0)
  const [details, setDetails] = createSignal(false)
  const onScrollChange = (offset: number) => change((old) => old.scrollOffset === offset ? old : { ...old, scrollOffset: offset })
  const filterError = createMemo(() => {
    const { include = [], exclude = [] } = state().opts
    if (include.length > 20 || exclude.length > 20) return 'Use at most 20 patterns in each filter.'
    if (include.some((pattern) => pattern.startsWith('!'))) return 'Put negative patterns in Files to exclude.'
    if ([...include, ...exclude].some((pattern) => pattern.length > 256)) return 'Each pattern must be at most 256 characters.'
    if (new TextEncoder().encode([...include, ...exclude].join('')).length > 4096) return 'Search filters must total at most 4 KiB.'
    return ''
  })

  // Debounces keystrokes so ripgrep does not spawn per character; toggles apply immediately since
  // they are part of the resource source, not debounced.
  const pushDebounced = debounce((q: string) => setDebounced(q), 200)
  const pushFolder = debounce((folder: string | undefined) => setDebouncedFolder(folder), 200)
  const onInput = (v: string) => {
    change((old) => ({ ...old, query: v, results: undefined, error: '' }))
    pushDebounced(v)
  }
  const setOption = (option: 'caseSensitive' | 'wholeWord' | 'regex', value: boolean) =>
    change((old) => ({ ...old, opts: { ...old.opts, [option]: value }, results: undefined, error: '' }))
  const pushFilters = debounce((revision: number) => setDebouncedFilterRevision(revision), 200)
  const setPatterns = (option: 'include' | 'exclude', value: string) => {
    // Invalidate the running request before changing options. Otherwise the reactive options
    // briefly start an un-debounced search with the new pattern on every keystroke.
    const revision = setFilterRevision((current) => current + 1)
    change((old) => ({ ...old,
      [option === 'include' ? 'includeText' : 'excludeText']: value,
      opts: { ...old.opts, [option]: value.split(',').map((pattern) => pattern.trim()).filter(Boolean) },
      results: undefined, error: '',
    }))
    pushFilters(revision)
  }
  createEffect(on(() => props.taskId, () => {
    pushDebounced.cancel(); pushFolder.cancel()
    setDebounced(state().query)
    setDebouncedFolder(state().opts.folder)
  }, { defer: true }))
  createEffect(on(() => state().opts.folder, (folder) => pushFolder(folder), { defer: true }))
  const [loading, setLoading] = createSignal(false)
  let disposed = false
  // The search in flight. A changed request, or unmounting, aborts it.
  const search = latestSignal()
  const requestKey = createMemo(() => JSON.stringify([activeNodeId(), props.taskId, state().query, debounced(), debouncedFolder(), state().opts,
    filterRevision(), debouncedFilterRevision(), state().scopeChanged]))
  createEffect(on(requestKey, () => {
    const taskId = props.taskId
    const input = state().query
    const q = debounced().trim()
    const opts = state().opts
    const scopeChanged = state().scopeChanged
    const signal = search.next()
    setLoading(false)
    if (activeNodeId() !== nodeId) return
    if (scopeChanged) return
    if (opts.folder !== debouncedFolder()) return
    if (filterError()) return
    if (filterRevision() !== debouncedFilterRevision()) return
    if (!q || input.trim() !== q) {
      return
    }
    setLoading(true)
    void findInFiles(taskId, q, opts, { nodeId, signal }).then((result) => {
      if (!disposed && !signal.aborted) change((old) => ({ ...old, results: result, error: '' }))
    }).catch((cause: unknown) => {
      if (!disposed && !signal.aborted)
        change((old) => ({ ...old, results: undefined, error: cause instanceof Error ? cause.message : 'Search failed.' }))
    }).finally(() => {
      if (!disposed && !signal.aborted) setLoading(false)
    })
  }))
  onCleanup(() => {
    disposed = true
    search.abort()
    pushDebounced.cancel()
    pushFolder.cancel()
    pushFilters.cancel()
  })

  const files = () => state().results?.files ?? []
  const totalHits = createMemo(() => files().reduce((n, f) => n + f.hits.length, 0))

  // The retained pane intent rather than a callback prop. See docs/panes/contributions.md § Contributions.
  function openHit(path: string, hit: SearchHit) {
    if (activeNodeId() !== nodeId || !state().results?.files.some((file) => file.path === path && file.hits.includes(hit))) return
    requestEditorReveal(props.taskId, path, hit.line, hit.col)
  }

  // Focus the box whenever the sidebar flips to Search, including when the retained `editor:search`
  // intent does the flipping (docs/panes/contributions.md § Contributions). Deferred to a microtask because
  // `TabPanel` keeps the panel hidden until the same render that sets `active`, and a hidden input
  // cannot take focus.
  let input: HTMLInputElement | undefined
  createEffect(on(() => props.active, (active) => {
    if (active) queueMicrotask(() => { if (!disposed && props.active) input?.focus({ preventScroll: true }) })
  }))

  const status = () => {
    if (filterError()) return filterError()
    if (state().error) return state().error
    if (!debounced().trim()) return "Type to search this task's files."
    if (loading()) return 'Searching…'
    const hits = `${totalHits()} result${totalHits() === 1 ? '' : 's'}`
    const where = `${files().length} file${files().length === 1 ? '' : 's'}`
    return `${hits} in ${where}`
  }

  return (
    <TabPanel idPrefix="editor-side" id="search" active={props.active ? 'search' : 'files'}
      scrollOffset={state().scrollOffset} onChange={onScrollChange}>
      {/* Stacked, not a row: the sidebar is narrow, and an input sharing it with three toggles
          leaves about a hundred pixels to type a query into. Two sm strips, so both sit on the pane's
          inset. The option buttons share one row; the result count sits below it. */}
      <FilterBar ariaLabel="Search">
        <Input
          ref={input}
          autofocus={props.active}
          kind="filter"
          size="sm"
          label="Search in files"
          placeholder="Search in files…"
          value={state().query}
          assist={false}
          onInput={(value) => onInput(value)}
        />
      </FilterBar>
      <Toolbar size="sm" ariaLabel="Search options">
        <IconButton icon="case-sensitive" label="Match case" pressed={!!state().opts.caseSensitive}
          onPress={() => setOption('caseSensitive', !state().opts.caseSensitive)} />
        <IconButton icon="whole-word" label="Whole word" pressed={!!state().opts.wholeWord}
          onPress={() => setOption('wholeWord', !state().opts.wholeWord)} />
        <IconButton icon="regex" label="Use regular expression" pressed={!!state().opts.regex}
          onPress={() => setOption('regex', !state().opts.regex)} />
        <IconButton icon="sliders-horizontal" label="Search details" expanded={details()}
          pressed={details()} onPress={() => setDetails(!details())} />
        <Show when={state().opts.folder}>
          <IconButton icon="folder-x" label="Clear folder scope"
            onPress={() => change((old) => ({ ...old, opts: { ...old.opts, folder: undefined }, scopeChanged: false, error: '', results: undefined }))} />
        </Show>
      </Toolbar>
      <Show when={state().opts.folder}>
        <Toolbar size="sm" ariaLabel="Folder scope"><Text>{state().opts.folder}</Text></Toolbar>
      </Show>
      <Show when={files().length}><Text emphasis="muted">{status()}</Text></Show>
      <Show when={details()}>
        <Stack gap="none">
          <Input label="Files to include" placeholder="Files to include" value={state().includeText} onInput={(value) => setPatterns('include', value)} />
          <Input label="Files to exclude" placeholder="Files to exclude" value={state().excludeText} onInput={(value) => setPatterns('exclude', value)} />
          <Text emphasis="muted">Comma-separated ripgrep globs. Excludes win. A literal comma in a pattern is unsupported. Hidden and ignored files are skipped.</Text>
        </Stack>
      </Show>
      <Show when={filterError()}><Alert tone="danger">{filterError()}</Alert></Show>

      <Show when={files().length} fallback={<EmptyState busy={loading()} size="sm" align="start">{status()}</EmptyState>}>
        {/* One collection per file rather than one for the whole result set: a hit's key has to be
            stable across a refetch, and `path:line:col` is the only thing about a hit that is. */}
        <Stack gap="none">
          {/* The client never learns the node's cap, so this cannot say how many it kept. */}
          <Show when={state().results?.truncated}>
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
                id={`editor.search:${nodeId}:${props.taskId}:${file.path}`}
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
