import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { filesOptions, type PullFile } from './queries'

// Global keyboard shortcuts + their overlays. Mounted once in App. Owns a single window
// keydown listener. PullList owns j/k (next/prev PR) — those keys are deliberately untouched
// here. All shortcuts except Escape are ignored while focus is in a form field.
type Overlay = 'help' | 'finder' | null

// Subsequence match (fuzzy): every char of the query appears in order within the path.
function subsequence(query: string, target: string): boolean {
  let i = 0
  for (let j = 0; j < target.length && i < query.length; j++) {
    if (target[j] === query[i]) i++
  }
  return i === query.length
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
}

export default function Shortcuts() {
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [overlay, setOverlay] = createSignal<Overlay>(null)
  const [filter, setFilter] = createSignal('')
  const [active, setActive] = createSignal(0)
  let inputRef: HTMLInputElement | undefined
  let lastRouteKey = ''

  // Current PR's changed files (same source/order PullDetail uses). Only fetched when a PR is open.
  const route = createMemo(() => {
    if (!params.owner || !params.repo || !params.number) return null
    return { owner: params.owner, repo: params.repo, number: params.number, key: `${params.owner}/${params.repo}#${params.number}` }
  })
  const files = createQuery(() => {
    const r = route()
    return filesOptions(r?.owner ?? '', r?.repo ?? '', r?.number ?? '', !!r)
  })
  const allFiles = (): PullFile[] => files.data ?? []
  const currentFile = () => (typeof searchParams.file === 'string' ? searchParams.file : undefined)

  // Filtered + ranked finder results: substring matches first, then looser subsequence matches.
  const results = createMemo(() => {
    const q = filter().trim().toLowerCase()
    const list = allFiles()
    if (!q) return list
    return list.filter((f) => {
      const p = f.path.toLowerCase()
      return p.includes(q) || subsequence(q, p)
    })
  })

  function openFinder() {
    if (!route()) return
    setFilter('')
    setActive(0)
    setOverlay('finder')
  }

  function selectFile(path: string) {
    setSearchParams({ file: path })
    setOverlay(null)
  }

  // Move ?file= to the next/prev changed file, wrapping. No-op when there are no files.
  function cycleFile(dir: 1 | -1) {
    const list = allFiles()
    if (!list.length) return
    const i = list.findIndex((f) => f.path === currentFile())
    const base = i < 0 ? (dir === 1 ? -1 : 0) : i
    const next = (base + dir + list.length) % list.length
    setSearchParams({ file: list[next].path })
  }

  const onKey = (e: KeyboardEvent) => {
    // Escape always closes, even from within a field (e.g. the finder input).
    if (e.key === 'Escape') {
      if (overlay()) {
        e.preventDefault()
        setOverlay(null)
      }
      return
    }

    // When the finder is open, its input owns arrow/enter navigation.
    if (overlay() === 'finder') {
      const list = results()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (list.length ? (a + 1) % list.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (list.length ? (a - 1 + list.length) % list.length : 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const sel = list[active()]
        if (sel) selectFile(sel.path)
      }
      return
    }

    // All remaining shortcuts ignore form fields.
    if (isTypingTarget(e.target)) return

    if (e.key === '?') {
      e.preventDefault()
      setOverlay((o) => (o === 'help' ? null : 'help'))
    } else if (e.key === '/') {
      e.preventDefault()
      openFinder()
    } else if (e.key === ']') {
      e.preventDefault()
      cycleFile(1)
    } else if (e.key === '[') {
      e.preventDefault()
      cycleFile(-1)
    }
  }

  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  // Finder state is per PR. Route changes keep `?file=` intact for DiffView's scroll target,
  // but the transient finder UI should not carry across pages.
  createEffect(() => {
    const key = route()?.key ?? ''
    if (key === lastRouteKey) return
    lastRouteKey = key
    setFilter('')
    setActive(0)
    setOverlay((current) => (current === 'finder' ? null : current))
  })

  // Focus the finder input when it opens; keep the active row in range as the filter narrows.
  createEffect(() => {
    if (overlay() === 'finder') inputRef?.focus()
  })
  createEffect(() => {
    const len = results().length
    if (active() >= len) setActive(len ? len - 1 : 0)
  })

  const shortcuts: Array<[string, string]> = [
    ['j / k', 'Next / previous PR'],
    ['[ / ]', 'Previous / next file'],
    ['/', 'Find file in this PR'],
    ['?', 'Toggle this help'],
    ['Esc', 'Close overlay'],
  ]

  // Split a path into directory + basename so the finder can emphasize the filename.
  function splitPath(path: string) {
    const i = path.lastIndexOf('/')
    return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
  }

  return (
    <Show when={overlay()}>
      <div class="overlay-backdrop" onClick={() => setOverlay(null)}>
        <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <Show when={overlay() === 'help'}>
            <div class="overlay-title">Keyboard shortcuts</div>
            <dl class="help-list">
              <For each={shortcuts}>
                {([key, desc]) => (
                  <>
                    <dt class="help-key">{key}</dt>
                    <dd class="help-desc">{desc}</dd>
                  </>
                )}
              </For>
            </dl>
          </Show>

          <Show when={overlay() === 'finder'}>
            <input
              ref={inputRef}
              class="finder-input"
              placeholder="Find file…"
              value={filter()}
              onInput={(e) => {
                setFilter(e.currentTarget.value)
                setActive(0)
              }}
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
                        classList={{ active: i() === active() }}
                        onMouseMove={() => setActive(i())}
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
          </Show>
        </div>
      </div>
    </Show>
  )
}
