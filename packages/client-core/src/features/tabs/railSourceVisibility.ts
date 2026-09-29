import { createEffect, createMemo, onCleanup } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../../infra/queries'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { defaultSourceId, sourceRegistry } from '../../host/registries/sources/sources'
import { commandRegistry, registerCommands } from '../../host/registries/commands/commands'
import type { SourceEntry } from './railSources'
import { savePref, type SavePrefOptions } from '../settings/savePref'
import { selectedSource, setSelectedSource } from '../tasks/tasks'

// Whether a plugin's source has an icon in the desktop's left rail (docs/frontend.md § Rail source
// visibility). A presentation choice and never an availability gate: `availableSources` still answers
// "can this source open?", and a hidden source stays open when a command or the palette selects it.
// Only the desktop's icon list reads this. The terminal's source menu lists every available source.
//
// The preference is the host's, one device-wide map keyed by `<pluginId>/<sourceId>`. A plugin never
// reads or writes it: the switch is drawn by the host, under Settings > Plugins and in the plugin strip
// above a plugin's own page. Core's sources are never hidden.

/** How many choices the map keeps. Far more sources than anyone installs; a bound so a hand-edited
 *  acorn.json cannot hand the rail an unbounded object. */
const MAX_CHOICES = 256

export const railSourceKey = (pluginId: string, sourceId: string): string => `${pluginId}/${sourceId}`

/** The person's choices, read defensively: the value may come from acorn.json. A malformed map reads as
 *  no choices, and a malformed entry is skipped, so each source falls back to its own default. */
export function parseRailSourceVisibility(raw: string | undefined): Record<string, boolean> {
  if (!raw) return {}
  let value: unknown
  try { value = JSON.parse(raw) } catch { return {} }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const choices: Record<string, boolean> = {}
  for (const [key, shown] of Object.entries(value).slice(0, MAX_CHOICES)) {
    if (typeof shown === 'boolean' && key.length <= 160 && key.includes('/')) choices[key] = shown
  }
  return choices
}

/** A source a plugin contributed, which the person may show or hide. */
export type PluginRailSource = { pluginId: string; id: string; label: string; glyph: string; shownByDefault: boolean }

/** Every registered plugin source, or one plugin's, in rail order. The owner comes from the registry,
 *  not from anything the plugin declared, so a switch always names the plugin that really contributed
 *  the source. */
export function pluginRailSources(pluginId?: string): PluginRailSource[] {
  return sourceRegistry.entries()
    .flatMap((source): PluginRailSource[] => {
      const owner = sourceRegistry.ownerOf(source.id)
      if (!owner || (pluginId !== undefined && owner !== pluginId)) return []
      return [{ pluginId: owner, id: source.id, label: source.label, glyph: source.glyph, shownByDefault: source.showInRailByDefault ?? true }]
    })
    .sort((a, b) => (sourceRegistry.get(a.id)?.order ?? 0) - (sourceRegistry.get(b.id)?.order ?? 0) || a.id.localeCompare(b.id))
}

/** Does the rail draw this source's icon? The person's choice first, then the source's default. */
export function shownInRail(sourceId: string, choices: Readonly<Record<string, boolean>>): boolean {
  const owner = sourceRegistry.ownerOf(sourceId)
  if (!owner) return true
  return choices[railSourceKey(owner, sourceId)] ?? sourceRegistry.get(sourceId)?.showInRailByDefault ?? true
}

export type RailSourceVisibility = {
  shown: (sourceId: string) => boolean
  /** Show or hide one source. Hiding the source on screen goes back to Home, the one place this moves
   *  the view: a source opened from the palette stays open while hidden, but turning its icon off is a
   *  request to leave it. Showing one adds the icon and moves nothing. */
  setShown: (source: Pick<PluginRailSource, 'pluginId' | 'id'>, shown: boolean, options?: SavePrefOptions) => Promise<boolean>
}

export function createRailSourceVisibility(): RailSourceVisibility {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const choices = createMemo(() => parseRailSourceVisibility(prefs.data?.[PrefKeys.railSourceVisibility]))
  return {
    shown: (sourceId) => shownInRail(sourceId, choices()),
    setShown: async (source, shown, options) => {
      const saved = await savePref(qc, PrefKeys.railSourceVisibility, JSON.stringify({ ...choices(), [railSourceKey(source.pluginId, source.id)]: shown }), options)
      if (saved && !shown && selectedSource() === source.id) setSelectedSource(defaultSourceId() ?? null)
      return saved
    },
  }
}

/**
 * One palette row, **Open <label>**, for every source that is available but has no icon, opened by
 * `open` the way a click on its icon would be. The row goes when the source becomes unavailable or is
 * shown again, and with its plugin. A plugin that already registers `source.<id>.open` keeps its own row
 * and gets no second one.
 */
export function createHiddenSourceOpeners(
  available: () => readonly SourceEntry[],
  shown: (sourceId: string) => boolean,
  open: (source: SourceEntry) => void,
): void {
  // Only the ids matter below, so the rows registered here, which change the command registry, do not
  // re-run the effect that registered them.
  const ownOpeners = createMemo(
    () => commandRegistry.entries().map((command) => /^source\.(.+)\.open$/.exec(command.id)?.[1]).filter((id): id is string => !!id).sort(),
    [],
    { equals: (a, b) => a.join('\n') === b.join('\n') },
  )
  const hidden = createMemo(
    () => available().filter((source) => !shown(source.id) && !ownOpeners().includes(source.id)),
    [],
    { equals: (a, b) => a.map((source) => `${source.id}:${source.label}`).join('\n') === b.map((source) => `${source.id}:${source.label}`).join('\n') },
  )
  createEffect(() => {
    const sources = hidden()
    if (!sources.length) return
    const openers = registerCommands(sources.map((source) => ({
      id: `rail.source.${source.id}.open`,
      title: `Open ${source.label}`,
      hint: 'hidden from the left rail',
      category: 'navigation' as const,
      palette: true,
      // The rail is this device's view of the node, not a property of any one task or project.
      scope: 'none' as const,
      run: () => open(source),
    })))
    onCleanup(() => openers.dispose())
  })
}
