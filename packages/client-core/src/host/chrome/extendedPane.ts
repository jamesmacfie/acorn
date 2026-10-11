// Which component this host wraps a plugin pane's reserved regions in (docs/tui/host-switch.md § The host
// switch).
//
// The same seam as `layouts/table.ts`, `tree/table.ts` and ./sourcePanel.ts. The frame registration pass
// builds contributions for every host, and `ChromeExtendedPane` is DOM all the way down, which the
// terminal's cell reconciler refuses. So each host supplies its own component.
//
// Types and one pure rule only, so a bare-Node suite can import the frame registration pass without a Solid transform.
// The components themselves stay behind the caller's `lazy`.

import type { Component, JSX } from 'solid-js'
import type { DetailRegionProps } from '@acorn/protocol/extensionPoints.ts'
import type { PanelRegion } from '../../features/dashboards/region'

/** The remote points an owner mounted above and below one of its detail views (`mounts`), and what
 *  each contributor's tree is mounted with (docs/plugins/detail-regions.md). */
export type DetailRegions = {
  headerPointId?: string
  footerPointId?: string
  subject: () => DetailRegionProps
}

/**
 * What a detail region mounts its contributors under, or `undefined` while the owner shows no
 * resource, when nothing mounts. Both hosts key a `Show` on it: a new surface or project remounts
 * the contributors, because a tree's bridge binds its scope at mount, and a new item is a props
 * update on the same workers.
 */
export const detailMountKey = (subject: DetailRegionProps): string | undefined =>
  (subject.item ?? subject.refId) ? `${subject.surface}\0${subject.projectId ?? ''}` : undefined

/** What both hosts' `ExtendedPane` takes: the owner's own frame, and the point ids of the rectangles
 *  it reserved for somebody else (docs/plugins/cooperative-extension-points.md § Cooperative extension points). */
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
  /** The detail regions a project pane's owner mounted, above and below its own view. */
  detail?: DetailRegions
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
