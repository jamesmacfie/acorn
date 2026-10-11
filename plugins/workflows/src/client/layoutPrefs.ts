// Where the canvas draws each node, per device (docs/workflows/editor-details.md § Where positions live).
//
// Positions are not in the definition: a definition saved to a repository is read on machines with
// different screens, and a committed x/y is noise in every diff. They live in device storage, which is
// a no-op on a host with nowhere to keep one.
//
// The operations that are easy to forget are here rather than in the graph view: a renamed node keeps
// its position, and a deleted definition takes its layout with it.
import { clearLocal, readLocal, writeLocal } from '@acorn/plugin-api/client'

export type NodePosition = { x: number; y: number }
export type WorkflowLayout = Record<string, NodePosition>

export const layoutKey = (defId: string): string => `plugin:workflows:layout:${defId}`

/** How long after the last move the layout is written. A drag is a burst of positions and only the
 *  one it ends on is worth keeping. */
export const LAYOUT_WRITE_DELAY_MS = 400

const isPosition = (value: unknown): value is NodePosition =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as NodePosition).x === 'number' &&
  typeof (value as NodePosition).y === 'number'

export function readLayout(defId: string): WorkflowLayout {
  const raw = readLocal(layoutKey(defId))
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, value]) => isPosition(value)),
    ) as WorkflowLayout
  } catch {
    return {}
  }
}

export function writeLayout(defId: string, layout: WorkflowLayout): void {
  if (!Object.keys(layout).length) return clearLocal(layoutKey(defId))
  writeLocal(layoutKey(defId), JSON.stringify(layout))
}

/** A renamed node keeps where it was put. */
export function renameInLayout(defId: string, from: string, to: string): void {
  const layout = readLayout(defId)
  if (!(from in layout) || from === to) return
  const { [from]: moved, ...rest } = layout
  writeLayout(defId, { ...rest, [to]: moved })
}

/** A deleted definition takes its layout with it. `forgetNodeInLayout` does the same for a node. */
export function forgetLayout(defId: string): void {
  clearLocal(layoutKey(defId))
}

export function forgetNodeInLayout(defId: string, name: string): void {
  const layout = readLayout(defId)
  if (!(name in layout)) return
  const { [name]: _gone, ...rest } = layout
  writeLayout(defId, rest)
}
