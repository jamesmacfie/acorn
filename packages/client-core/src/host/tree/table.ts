// Which component this host draws a loaded plugin's tree with.
//
// The sibling of `layouts/table.ts`, and it exists for the same reason: `frames/register.ts` turns a
// manifest into contributions for every host, and until the terminal grew a tree host it named the
// DOM's `RemoteTree` directly (docs/future/terminal/phase-5-loaded-plugins.md). The host package
// supplies its own; the DOM's is the fallback, so nothing on the desktop had to change.
//
// Types only, so the bare-Node suites can import the registration pass without a Solid transform.

import type { Component } from 'solid-js'
import type { RemoteContribution } from './treeRegistry'

/** What both hosts' `RemoteTree` takes. `scope` is an accessor because the binding outlives any one
 *  tree; see the DOM component's own header. */
export type RemoteTreeComponent = Component<{
  contribution: RemoteContribution
  props: () => unknown
  scope?: () => { taskId?: string; projectId?: string; item?: string }
}>

let supplied: RemoteTreeComponent | null = null

/** Called once by a host package's composition root, before any plugin surface registers. */
export function setRemoteTree(component: RemoteTreeComponent): void {
  supplied = component
}

/** This host's component, or undefined where no host supplied one and the DOM's is the answer. */
export const suppliedRemoteTree = (): RemoteTreeComponent | undefined => supplied ?? undefined

/** Test seam. The component is module-level, so a suite must not inherit the previous one's host. */
export function _resetRemoteTree(): void {
  supplied = null
}
