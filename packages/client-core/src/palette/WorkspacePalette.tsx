import { createMemo, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { resolveWorkspaceColor } from '@acorn/protocol/workspaceIdentity.ts'
import { createFleetWorkspaces, selectFleetWorkspace, type FleetWorkspace } from '../workspaces/fleetWorkspaces'
import { fuzzyScore } from './model'
import { createOverlayPalette } from './overlay'
import { PaletteSurface } from './PaletteSurface'
import './palette.css'

export default function WorkspacePalette() {
  const navigate = useNavigate()
  const fleet = createFleetWorkspaces()

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

  const matches = createMemo<FleetWorkspace[]>(() => {
    const all = fleet().entries
    const q = palette.query().trim()
    if (!q) return all
    // The node label is part of the haystack, not a separate filter: two nodes both having a "Default"
    // workspace is the normal case, and typing the node name is how the owner disambiguates.
    return all
      .map((entry) => ({ entry, score: fuzzyScore(q, fleet().grouped ? `${entry.workspace.name} ${entry.node.label}` : entry.workspace.name) }))
      .filter((x): x is { entry: FleetWorkspace; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.entry)
  })

  function pick(entry: FleetWorkspace) {
    palette.close()
    // Rail source is restored per-workspace by the activeWorkspace effect in App.tsx.
    selectFleetWorkspace(entry, navigate)
  }

  const glyph = (w: FleetWorkspace['workspace']) => (w.icon?.kind === 'emoji' ? `${w.icon.value} ` : '')

  return (
    <PaletteSurface
      palette={palette}
      items={matches()}
      ariaLabel="Switch workspace"
      placeholder="Switch workspace…"
      emptyText="No workspaces."
      onPick={(entry) => pick(entry)}
      row={(entry) => {
        const w = entry.workspace
        return (
          <>
            <span class="ws-color-dot" style={{ background: resolveWorkspaceColor(w.color, w.name) }} />
            <span class="palette-label">{glyph(w)}{w.name}</span>
            <Show when={fleet().grouped}>
              <span class="palette-hint muted">{entry.node.label}</span>
            </Show>
            <Show when={w.projects.length}>
              <span class="palette-hint muted">{w.projects.length} projects</span>
            </Show>
          </>
        )
      }}
    />
  )
}
