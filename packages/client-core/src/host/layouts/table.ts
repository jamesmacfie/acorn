// Which table of layout components this host draws with.
//
// `index.ts` holds the DOM's, and until terminal phase 2 the pane registry named it directly: a pane
// that declared a layout got back a component that mounted `LAYOUTS`, so `paneContributions()` handed
// a second host a component it could not use (docs/tui/host-switch.md § The host switch). This is the same seam
// `KIT_COMPONENTS` already has one of: the host package supplies its table, and the DOM's is the
// fallback so nothing on the desktop had to change.
//
// Types only, so a bare-Node test suite can import the pane registry without a Solid transform. The
// component tables themselves stay behind the registry's `lazy`.

import type { Component } from 'solid-js'
import type { PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import type { Layout } from './regions'

let supplied: Record<PaneLayoutName, Layout> | null = null

/** What a pane's layout or region draws while its code loads. `label` is the pane's. */
export type RegionPlaceholder = Component<{ label: string }>
let placeholder: RegionPlaceholder | null = null

/** Called once by a host package's composition root, before the first pane draws. */
export function setLayouts(table: Record<PaneLayoutName, Layout>): void {
  supplied = table
}

/** This host's component for a layout, or undefined where no host supplied a table and the DOM's is
 *  the answer. */
export const suppliedLayout = (name: PaneLayoutName): Layout | undefined => supplied?.[name]

/** Called once by a host package's composition root, beside `setLayouts`. Each host draws its own,
 *  because a region placeholder is cells in one host and markup in the other. With none supplied, a
 *  loading region draws nothing. */
export function setRegionPlaceholder(component: RegionPlaceholder): void {
  placeholder = component
}

export const suppliedRegionPlaceholder = (): RegionPlaceholder | null => placeholder

/** Test seam. The table is module-level, so a suite must not inherit the previous one's host. */
export function _resetLayouts(): void {
  supplied = null
  placeholder = null
}
