import { createEffect, createMemo, For, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { useChangedFiles } from './changedFiles'
import { fuzzyScore } from './features/palette/model'
import { createOverlayPalette } from './features/palette/overlay'
import { isTypingTarget } from './lib/isTypingTarget'
import type { PullFile } from './queries'

// Global keyboard shortcuts + the file finder. Mounted once in App. Owns a single window
// keydown listener (via the shared createOverlayPalette hook). PullList owns j/k (next/prev PR) —
// those keys are deliberately untouched here. All shortcuts except Escape are ignored while focus
// is in a typing target (form fields and contentEditable surfaces).
// The finder is local; the shortcut *reference* now lives in Settings → Shortcuts, so `?` opens
// that tab (via onOpenShortcuts) rather than a local help overlay.

// Keyboard shortcut reference, rendered by the Settings → Shortcuts tab.
export const SHORTCUTS: Array<[string, string]> = [
  ['⌘1 – ⌘9', 'Jump to task 1–9 in the rail'],
  ['⌘K', 'Command palette (panes, tasks, run targets)'],
  ['⌘P', 'Go to file in the task worktree'],
  ['j / k', 'Next / previous PR'],
  ['[ / ]', 'Previous / next file'],
  ['/', 'Find file in this PR'],
  ['c', 'Create pull request'],
  ['?', 'Open keyboard shortcuts'],
  ['Esc', 'Close overlay'],
]

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
    // The remaining bare-key shortcuts, active only while the finder is closed. They ignore
    // typing targets and modifier chords — those belong to text entry and the OS/browser (⌘C, etc.).
    onClosedKey: (e) => {
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '?') {
        e.preventDefault()
        props.onOpenShortcuts()
      } else if (e.key === '/') {
        e.preventDefault()
        if (route()) finder.show()
      } else if (e.key === ']') {
        e.preventDefault()
        changedFiles.cycleFile(1)
      } else if (e.key === '[') {
        e.preventDefault()
        changedFiles.cycleFile(-1)
      } else if (e.key === 'c' && params.owner && params.repo) {
        e.preventDefault()
        navigate(`/${params.owner}/${params.repo}/new`)
      }
    },
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
        <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
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
