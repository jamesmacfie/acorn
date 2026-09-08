// Where the canvas draws each node, per device (docs/state-ownership.md § Device).
//
// Positions are not in the definition, and that is a decision rather than an omission: a definition
// saved to a repository is read on machines with different screens, and a committed x/y is noise in
// every diff (docs/workflows.md § Authoring). They live under `plugin:workflows:layout:<defId>` in
// device storage instead, which is the one guarded accessor for a per-device scrap and is a no-op on
// a host with nowhere to keep one (client-core kit/lib/deviceStorage.ts).
//
// The graph view reads and writes these (./editor/GraphView.tsx), 400 ms after a drag stops. The two
// operations that are easy to forget are here rather than there: a rename has to carry the position
// with the node, and deleting a definition has to take its layout with it.
import { clearLocal, readLocal, writeLocal } from '@acorn/plugin-api/client'

export type NodePosition = { x: number; y: number }
export type WorkflowLayout = Record<string, NodePosition>

export const layoutKey = (defId: string): string => `plugin:workflows:layout:${defId}`

/** How long after the last move the layout is written. A drag is a burst of positions and only the
 *  one it ends on is worth keeping. */
export const LAYOUT_WRITE_DELAY_MS = 400

const isPosition = (value: unknown): value is NodePosition =>
  !!value && typeof value === 'object'
  && typeof (value as NodePosition).x === 'number' && typeof (value as NodePosition).y === 'number'

export function readLayout(defId: string): WorkflowLayout {
  const raw = readLocal(layoutKey(defId))
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, value]) => isPosition(value))) as WorkflowLayout
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

/** A deleted definition takes its layout with it, and so does a deleted node. */
export function forgetLayout(defId: string): void {
  clearLocal(layoutKey(defId))
}

export function forgetNodeInLayout(defId: string, name: string): void {
  const layout = readLayout(defId)
  if (!(name in layout)) return
  const { [name]: _gone, ...rest } = layout
  writeLayout(defId, rest)
}
