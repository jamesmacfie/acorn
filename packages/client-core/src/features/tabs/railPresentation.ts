import { createMemo } from 'solid-js'
import { sourceRegistry, type RailPresentation } from '../../host/registries/sources/sources'

type RailArtwork = RailPresentation['artwork']

// The same picture, so a refetch that changed only the words keeps the drawn artwork rather than
// drawing it again.
const sameArtwork = (a: RailArtwork, b: RailArtwork): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.owner.nodeId === b.owner.nodeId &&
    a.owner.pluginId === b.owner.pluginId &&
    a.image.path === b.image.path &&
    a.image.revision === b.image.revision &&
    a.image.alt === b.image.alt)

/** The host's words for an answer it could not refresh, for the tooltip legend. */
const notice = (presentation: RailPresentation | null): string | undefined =>
  presentation?.freshness === 'stale'
    ? 'Not updating: this is the last information it sent'
    : presentation?.freshness === 'unavailable'
      ? 'Its information is unavailable right now'
      : undefined

/** What one drawn source button shows beyond its glyph and label. Call it once per drawn button, so
 *  a hidden source reads nothing. A source registered again, after an update or a reload, starts
 *  over from its new registration, so the old one's answer is never drawn under it. */
export function createSourcePresentation(sourceId: string) {
  const contribution = createMemo(() => sourceRegistry.get(sourceId))
  const live = createMemo(() => contribution()?.createRailPresentation?.())
  const current = (): RailPresentation | null => live()?.() ?? null
  return {
    artwork: createMemo(() => current()?.artwork, undefined, { equals: sameArtwork }),
    tooltip: () => current()?.tooltip,
    notice: () => notice(current()),
  }
}
