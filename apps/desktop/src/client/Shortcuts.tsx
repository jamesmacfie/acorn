import { createEffect, createMemo, For, onCleanup, onMount, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { useChangedFiles } from './changedFiles'
import { fuzzyScore } from './features/palette/model'
import { createOverlayPalette } from './features/palette/overlay'
import type { PullFile } from './queries'
import { registerCommands } from './registries/commands'
import { registerKeybindings } from './registries/keybindings'

// Global keyboard shortcuts + the file finder. Mounted once in App. PullList owns j/k (next/prev
// PR) — those keys are deliberately untouched here. Global shortcut dispatch lives in the command
// registry; the open finder handles its own dialog-scoped navigation.
// The finder is local; the shortcut *reference* now lives in Settings → Shortcuts, so `?` opens
// that tab (via onOpenShortcuts) rather than a local help overlay.

export default function Shortcuts(props: { onOpenShortcuts: () => void }) {
  const params = useParams()
  const navigate = useNavigate()
  let lastRouteKey = ''

  // Current PR's changed files (same source/order PullDetail uses). Only fetched when a PR is open.
  const route = createMemo(() => {
    if (!params.owner || !params.repo || !params.number) return null
    return { owner: params.owner, repo: params.repo, number: params.number, key: `${params.owner}/${params.repo}#${params.number}` }
  })
  const changedFiles = useChangedFiles(route)
  const allFiles = changedFiles.files

  const finder = createOverlayPalette({
    count: () => results().length,
    onPick: (index) => {
      const sel = results()[index]
      if (sel) selectFile(sel.path)
    },
  })

  onMount(() => {
    const commands = registerCommands([
      { id: 'help.shortcuts.open', title: 'Open keyboard shortcuts', category: 'navigation', run: props.onOpenShortcuts },
      { id: 'github.files.find', title: 'Find file in this pull request', category: 'navigation', when: () => !!route(), run: finder.show },
      { id: 'github.files.next', title: 'Next changed file', category: 'navigation', when: () => !!route(), run: () => changedFiles.cycleFile(1) },
      { id: 'github.files.previous', title: 'Previous changed file', category: 'navigation', when: () => !!route(), run: () => changedFiles.cycleFile(-1) },
      {
        id: 'github.pull.create', title: 'Create pull request', category: 'navigation',
        when: () => !!params.owner && !!params.repo,
        run: () => navigate(`/${params.owner}/${params.repo}/new`),
      },
    ])
    const bindings = registerKeybindings([
      { id: 'help.shortcuts.open', command: 'help.shortcuts.open', description: 'Open keyboard shortcuts', category: 'Global', defaultChord: 'shift+?', when: 'typing-exempt' },
      { id: 'github.files.find', command: 'github.files.find', description: 'Find file in this pull request', category: 'Pull requests', defaultChord: '/', when: 'typing-exempt', active: () => !!route() },
      { id: 'github.files.next', command: 'github.files.next', description: 'Next changed file', category: 'Pull requests', defaultChord: ']', when: 'typing-exempt', active: () => !!route() },
      { id: 'github.files.previous', command: 'github.files.previous', description: 'Previous changed file', category: 'Pull requests', defaultChord: '[', when: 'typing-exempt', active: () => !!route() },
      { id: 'github.pull.create', command: 'github.pull.create', description: 'Create pull request', category: 'Pull requests', defaultChord: 'c', when: 'typing-exempt', active: () => !!params.owner && !!params.repo },
    ])
    onCleanup(() => { bindings.dispose(); commands.dispose() })
  })

  // Finder results ranked with the palette's fuzzy scorer: every query char must appear in order
  // in the path, and contiguous runs / word-start hits score higher — so substring-ish matches
  // sort above looser subsequence ones. Ties keep the PR's file order (stable sort); an empty
  // query lists all files in PR order.
  const results = createMemo(() => {
    const q = finder.query().trim()
    const list = allFiles()
    if (!q) return list
    return list
      .map((file) => ({ file, score: fuzzyScore(q, file.path) }))
      .filter((x): x is { file: PullFile; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.file)
  })

  function selectFile(path: string) {
    changedFiles.selectFile(path)
    finder.close()
  }

  // Finder state is per PR. Route changes keep `?file=` intact for DiffView's scroll target,
  // but the transient finder UI should not carry across pages.
  createEffect(() => {
    const key = route()?.key ?? ''
    if (key === lastRouteKey) return
    lastRouteKey = key
    finder.close()
  })

  // Split a path into directory + basename so the finder can emphasize the filename.
  function splitPath(path: string) {
    const i = path.lastIndexOf('/')
    return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
  }

  return (
    <Show when={finder.open()}>
      <div class="overlay-backdrop" onClick={finder.close}>
        <div class="overlay" role="dialog" aria-modal="true" onKeyDown={finder.onKeyDown} onMouseDown={finder.onDialogMouseDown} onClick={(e) => e.stopPropagation()}>
          <input
            ref={finder.setInputRef}
            class="finder-input"
            placeholder="Find file…"
            value={finder.query()}
            onInput={(e) => finder.setQuery(e.currentTarget.value)}
          />
          <Show
            when={results().length}
            fallback={<p class="finder-empty">{allFiles().length ? 'No matching files.' : 'No changed files.'}</p>}
          >
            <ul class="finder-list">
              <For each={results()}>
                {(file, i) => {
                  const parts = splitPath(file.path)
                  return (
                    <li
                      class="finder-row"
                      classList={{ active: i() === finder.sel() }}
                      onMouseMove={() => finder.setSel(i())}
                      onClick={() => selectFile(file.path)}
                    >
                      <span class="finder-dir">{parts.dir}</span>
                      <span class="finder-name">{parts.name}</span>
                    </li>
                  )
                }}
              </For>
            </ul>
          </Show>
        </div>
      </div>
    </Show>
  )
}
