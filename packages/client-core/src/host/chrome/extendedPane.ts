// Which component this host wraps a plugin pane's reserved regions in.
//
// The fourth seam of this shape, after `layouts/table.ts`, `tree/table.ts` and `chrome/sourcePanel.ts`,
// and it is here for the same reason all three are: `frames/register.ts` turns a manifest into
// contributions for every host, and it named `chrome/ChromeExtendedPane.tsx` directly. That component is DOM
// all the way down — `<div class="extended-pane">`, `<aside>`, a `PanelGrid` sized in pixels — so a
// loaded plugin's pane that reserved a footer or an aside handed the cell reconciler a `div` and it
// refused (docs/tui.md § The host switch).
//
// Types only, so a bare-Node suite can import the frame registration pass without a Solid transform.
// The components themselves stay behind the caller's `lazy`.

import type { Component, JSX } from 'solid-js'
import type { PanelRegion } from '../../features/dashboards/region'

/** What both hosts' `ExtendedPane` takes: the owner's own frame, and the point ids of the rectangles
 *  it reserved for somebody else (docs/plugins.md § Cooperative extension points). */
export type ExtendedPaneProps = {
  /** The qualified point id of a `pane.footer`, when this pane reserved one. */
  footerPointId?: string
  /** The reserved `pane.aside`: its qualified point id, which is also the placement's owner id, and
   *  the owner's declared constraints. */
  aside?: { pointId: string; region: PanelRegion }
  /** The reserved `pane.inline-below` and `pane.inline-beside` rectangles, each holding another
   *  plugin's iframe. */
  inlineBelowPointId?: string
  inlineBesidePointId?: string
  taskId?: string
  projectId?: string | null
  children: JSX.Element
}

export type ExtendedPaneComponent = Component<ExtendedPaneProps>

let supplied: ExtendedPaneComponent | null = null

/** Called once by a host package's composition root, before any plugin surface registers. */
export function setExtendedPane(component: ExtendedPaneComponent): void {
  supplied = component
}

/** This host's component, or null where no host supplied one and the DOM's is the answer. */
export const suppliedExtendedPane = (): ExtendedPaneComponent | null => supplied

/** Test seam. The component is module-level, so a suite must not inherit the previous one's host. */
export function _resetExtendedPane(): void {
  supplied = null
}
