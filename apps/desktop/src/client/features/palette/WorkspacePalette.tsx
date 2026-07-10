import { createMemo, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import { workspacesOptions, type Workspace } from '../../queries'
import { resolveWorkspaceColor } from '../../../shared/workspaceIdentity'
import { fuzzyScore } from './model'
import { createOverlayPalette } from './overlay'
import './palette.css'

// ⌘L workspace switcher: fuzzy-jump between workspaces (docs/workspaces). Mirrors the topbar
// WorkspacePicker's onSelect — picking a workspace navigates to its first repo (active workspace is
// derived from the current repo, so no extra state). Reuses the shared palette shell like FilePalette.
export default function WorkspacePalette() {
  const navigate = useNavigate()
  const workspaces = createQuery(() => workspacesOptions(true))

  const palette = createOverlayPalette({
    id: 'workspaces',
    title: 'Switch workspace',
    toggleChord: 'meta+l',
    count: () => matches().length,
    onPick: (index) => {
      const w = matches()[index]
      if (w) pick(w)
    },
  })

  const matches = createMemo<Workspace[]>(() => {
    const all = workspaces.data ?? []
    const q = palette.query().trim()
    if (!q) return all
    return all
      .map((w) => ({ w, score: fuzzyScore(q, w.name) }))
      .filter((x): x is { w: Workspace; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.w)
  })

  function pick(w: Workspace) {
    palette.close()
    const first = w.repos[0]
    if (!first) return // empty workspace has nowhere to go, same as the topbar picker
    // Rail source is restored per-workspace by the activeWorkspace effect in App.tsx.
    navigate(`/${first.owner}/${first.name}`)
  }

  const glyph = (w: Workspace) => (w.icon?.kind === 'emoji' ? `${w.icon.value} ` : '')

  return (
    <Show when={palette.open()}>
      <div class="overlay-backdrop" onClick={palette.close}>
        <div class="overlay palette" role="dialog" aria-modal="true" onKeyDown={palette.onKeyDown} onClick={(e) => e.stopPropagation()}>
          <input
            ref={palette.setInputRef}
            class="palette-input"
            placeholder="Switch workspace…"
            value={palette.query()}
            onInput={(e) => palette.setQuery(e.currentTarget.value)}
          />
          <ul class="palette-list">
            <For each={matches()} fallback={<li class="palette-empty muted">No workspaces.</li>}>
              {(w, i) => (
                <li>
                  <button
                    type="button"
                    class="palette-row"
                    classList={{ selected: i() === palette.sel() }}
                    onMouseEnter={() => palette.setSel(i())}
                    onClick={() => pick(w)}
                  >
                    <span class="ws-color-dot" style={{ background: resolveWorkspaceColor(w.color, w.name) }} />
                    <span class="palette-label">{glyph(w)}{w.name}</span>
                    <Show when={(w.repos ?? []).length}>
                      <span class="palette-hint muted">{w.repos.length} repos</span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>
    </Show>
  )
}
