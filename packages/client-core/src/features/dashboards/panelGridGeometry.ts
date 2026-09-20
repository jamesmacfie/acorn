import type { JSX } from 'solid-js'
import type { PanelLayout, Rect } from './layout'
import type { PanelDefinition, PanelId } from './model'

type PositionedGesture = {
  id: PanelId
  offset?: { x: number; y: number }
}

const boxOf = (rect: Rect, pitch: number, gap: number): JSX.CSSProperties => ({
  left: `${rect.x * pitch}px`,
  top: `${rect.y * pitch}px`,
  width: `${rect.w * pitch - gap}px`,
  height: `${rect.h * pitch - gap}px`,
})

/** Pixel projection of the already-resolved cell layout. No placement state lives here. */
export function panelGridHeight(
  panels: readonly PanelDefinition[],
  layout: PanelLayout,
  pitch: number,
  gap: number,
): number {
  const rows = panels.reduce((deepest, entry) => {
    const rect = layout.rects[entry.id]
    return rect ? Math.max(deepest, rect.y + rect.h) : deepest
  }, 0)
  return Math.max(0, rows * pitch - gap)
}

export function panelSlotStyle(
  id: PanelId,
  layout: PanelLayout,
  collapsed: boolean,
  pitch: number,
  gap: number,
  gesture?: PositionedGesture,
): JSX.CSSProperties {
  const rect = layout.rects[id]
  if (collapsed || !rect) return {}
  const offset = gesture?.id === id ? gesture.offset : undefined
  return {
    ...boxOf(rect, pitch, gap),
    ...(offset ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(1.015)` } : {}),
  }
}

export function panelPlaceholderStyle(
  layout: PanelLayout,
  pitch: number,
  gap: number,
  activeId?: PanelId,
): JSX.CSSProperties {
  const rect = activeId ? layout.rects[activeId] : undefined
  return rect ? boxOf(rect, pitch, gap) : {}
}
