// Focus groups: every region of every layout, in document order, and which one has focus.
//
// A layout region is a focus group (docs/future/layout/07-focus-and-keys.md § Focus is a property of
// the tree). `nextRegion` cycles the groups inside one pane, `nextPane` cycles the panes of the task
// row, and each group remembers the node focus was last on so coming back lands where you left.
// This generalises the single `focusedPane` per task to every region of every pane.
//
// It is also the app's one emit point for "focus changed", which `docs/future/events.md § Not built
// here` parked here so it would have exactly one implementation. The event is renderer-local by
// construction: focus is a fact about a window, so a node has nothing to say about it and never
// broadcasts one.

import { createSignal, onCleanup } from 'solid-js'
import { clientEvents } from '../registries/clientEvents'
import { activeTaskId, setFocusedPane } from '../tasks/tasks'

export type RegionRef = { paneId: string; regionId: string }

type Group = RegionRef & {
  element: HTMLElement
  /** The node focus was last on inside this group, so re-entering restores rather than resets. */
  last?: HTMLElement
}

const groups: Group[] = []
const [focused, setFocused] = createSignal<RegionRef | null>(null)

/** Which region has focus, or null before anything in a layout has been focused. */
export const focusedRegion = (): RegionRef | null => focused()

/** Document order, so the chords walk the layout the way it is drawn rather than the order regions
 *  happened to mount in. Recomputed per call: the list is one entry per visible region. */
const ordered = (): Group[] =>
  [...groups].sort((a, b) =>
    a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  )

export function registerRegion(element: HTMLElement, ref: RegionRef): () => void {
  const group: Group = { ...ref, element }
  groups.push(group)
  return () => {
    const index = groups.indexOf(group)
    if (index >= 0) groups.splice(index, 1)
  }
}

/** Called when focus lands inside a region. Idempotent, because focusin fires for every node. */
export function markRegionFocused(ref: RegionRef, node?: HTMLElement): void {
  const group = groups.find((candidate) => candidate.paneId === ref.paneId && candidate.regionId === ref.regionId)
  if (group && node) group.last = node
  const current = focused()
  if (current && current.paneId === ref.paneId && current.regionId === ref.regionId) return
  setFocused({ paneId: ref.paneId, regionId: ref.regionId })
  const taskId = activeTaskId()
  if (taskId) setFocusedPane(taskId, ref.paneId)
  clientEvents.emit('runtime:focus-changed', { taskId, paneId: ref.paneId, regionId: ref.regionId })
}

/** The first thing inside a region a keyboard can reach, for a group with nothing remembered. */
const firstStop = (element: HTMLElement): HTMLElement | undefined =>
  element.querySelector<HTMLElement>('[tabindex]:not([tabindex="-1"]), button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
  ?? undefined

function enter(group: Group | undefined): boolean {
  if (!group) return false
  const target = (group.last?.isConnected ? group.last : undefined) ?? firstStop(group.element) ?? group.element
  // A region with nothing focusable in it still has to be reachable, or the cycle has a hole.
  if (!target.hasAttribute('tabindex') && target === group.element) target.tabIndex = -1
  target.focus()
  markRegionFocused(group, target)
  return true
}

/** Move to the next or previous region of the pane that has focus. Wraps. */
export function moveRegion(delta: 1 | -1): boolean {
  const current = focused()
  const inPane = ordered().filter((group) => group.paneId === (current?.paneId ?? ordered()[0]?.paneId))
  if (inPane.length < 2) return false
  const at = inPane.findIndex((group) => group.regionId === current?.regionId)
  return enter(inPane[(((at < 0 ? 0 : at) + delta) + inPane.length) % inPane.length])
}

/** Move to the next or previous pane in the task row, landing on whatever it last had focused. */
export function movePane(delta: 1 | -1): boolean {
  const panes: string[] = []
  for (const group of ordered()) if (!panes.includes(group.paneId)) panes.push(group.paneId)
  if (panes.length < 2) return false
  const at = panes.indexOf(focused()?.paneId ?? '')
  const paneId = panes[(((at < 0 ? 0 : at) + delta) + panes.length) % panes.length]
  return enter(ordered().find((group) => group.paneId === paneId))
}

/** Test seam. The list is module-level, so a suite must not inherit the previous one's regions. */
export function _resetRegions(): void {
  groups.length = 0
  setFocused(null)
}

// The directive a layout puts on each of its regions. Registration and the focusin marking are one
// thing, because a region that registers without reporting focus is a hole in the cycle.
export type RegionFocusOptions = RegionRef

export function regionFocus(element: HTMLElement, value: () => RegionFocusOptions): void {
  // Unregistered on cleanup rather than on disconnect: a directive runs inside its component's
  // reactive scope, and a closed pane that kept its slot would leave a hole in the cycle.
  onCleanup(registerRegion(element, value()))
  element.addEventListener('focusin', (event) => {
    markRegionFocused(value(), event.target instanceof HTMLElement ? event.target : undefined)
  })
  element.addEventListener('pointerdown', () => markRegionFocused(value()))
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      regionFocus: RegionFocusOptions
    }
  }
}
