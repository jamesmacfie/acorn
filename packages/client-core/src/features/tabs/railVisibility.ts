import type { QueryClient } from '@tanstack/solid-query'
import { defaultSourceId, sourceRegistry, type SourceContribution } from '../../host/registries/sources/sources'
import { commandRegistry } from '../../host/registries/commands/commands'
import type { SourceEntry } from './railSources'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { readDevicePrefs } from '../../infra/persistence/devicePrefs'
import { saveJsonPref } from '../settings/savePref'
import { selectedSource, setSelectedSource } from '../tasks/tasks'

// Whether the desktop rail draws a plugin source's icon (docs/frontend.md § Registries and plugins).
//
// Presentation, never availability. `availableSources()` still answers "can this source open?", and
// the rail, the palette opener and Settings each apply this on top of it. Filtering availability
// instead would make a command such as "Open Docker" select a source the shell then rejects.
//
// The preference holds explicit choices only, keyed `<pluginId>:<sourceId>`. An absent entry reads
// the source's declared default, and an entry for a source that is not registered right now is kept
// as inert data, so reinstalling the plugin brings the user's choice back.

export type RailVisibility = Readonly<Record<string, boolean>>

// Far more plugin sources than anyone installs, and small enough that a corrupt value can't grow the
// map without limit.
const MAX_ENTRIES = 512

export const railVisibilityKey = (pluginId: string, sourceId: string): string => `${pluginId}:${sourceId}`

export function parseRailVisibility(json: string | undefined): RailVisibility {
  if (!json) return {}
  try {
    const value: unknown = JSON.parse(json)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, shown]) => typeof shown === 'boolean').slice(0, MAX_ENTRIES))
  } catch {
    return {}
  }
}

/** Does the desktop rail draw this source? Core's own sources always do. A plugin's follows the
 *  user's switch, then the source's declared default. */
export function shownInRail(sourceId: string, visibility: RailVisibility): boolean {
  const owner = sourceRegistry.ownerOf(sourceId)
  if (!owner) return true
  return visibility[railVisibilityKey(owner, sourceId)] ?? sourceRegistry.get(sourceId)?.showInRailByDefault ?? true
}

/** Every source a plugin contributed, in rail order. Core's own are absent: they are not
 *  user-hideable. Pass a plugin id to narrow it to that plugin's. */
export function pluginSources(pluginId?: string): { pluginId: string; source: SourceContribution }[] {
  return sourceRegistry.entries()
    .flatMap((source) => {
      const owner = sourceRegistry.ownerOf(source.id)
      return owner && (pluginId === undefined || owner === pluginId) ? [{ pluginId: owner, source }] : []
    })
    .sort((a, b) => a.source.order - b.source.order || a.source.id.localeCompare(b.source.id))
}

/** Save one switch. Read from the device store rather than the query cache, so two quick writes build
 *  on each other instead of the second one undoing the first. Hiding the source on screen takes the
 *  user Home, which is the one place this preference changes what is selected. */
export async function setShownInRail(queryClient: QueryClient, pluginId: string, sourceId: string, shown: boolean): Promise<void> {
  const next = { ...parseRailVisibility(readDevicePrefs()[PrefKeys.railVisibility]), [railVisibilityKey(pluginId, sourceId)]: shown }
  await saveJsonPref(queryClient, PrefKeys.railVisibility, next)
  if (!shown && selectedSource() === sourceId) setSelectedSource(defaultSourceId() ?? null)
}

/** The command id docker, agents and github already use for "open my source". The palette's
 *  generated opener stands aside for it (host/palette/sourceOpeners.ts). */
export const pluginOpenerId = (sourceId: string): string => `source.${sourceId}.open`

/** Which openable sources get a generated palette opener: the ones the rail is not drawing, less any
 *  whose plugin already opens it with its own command. */
export function hiddenSourcesToOpen(available: readonly SourceEntry[], railVisibility: string | undefined): SourceEntry[] {
  const visibility = parseRailVisibility(railVisibility)
  return available.filter((source) => !shownInRail(source.id, visibility) && !commandRegistry.get(pluginOpenerId(source.id)))
}
