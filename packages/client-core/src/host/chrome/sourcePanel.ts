// Which component this host draws a descriptor source's rail list with (docs/tui/host-switch.md § The
// host switch).
//
// The same seam as `KIT_COMPONENTS` and `layouts/table.ts`. The desktop's `ChromeSourceList` is DOM all
// the way down, and the terminal's cell reconciler throws "Unknown component type" on DOM elements, so
// each host supplies its own.
//
// A whole contribution rather than a component, because the two hosts do not put the halves in the
// same place: the desktop draws one surface across the window, and the terminal puts the list in its
// Browse panel and the detail in the main one (docs/tui/chrome.md § The screen). Both shapes are already in
// `SourceContribution`, so this seam hands back the fields that say which.
//
// Types only, so a bare-Node suite can import the chrome registry without a Solid transform.

import type { PluginSourceDescriptor } from '@acorn/protocol/api.ts'
import type { SourceContribution } from '../registries/sources/sources'

/** What a host draws a descriptor source with: one component, or a list and a detail. */
export type SourcePanel = Pick<SourceContribution, 'component' | 'regions'>

export type SourcePanelFactory = (input: { pluginId: string; descriptor: PluginSourceDescriptor }) => SourcePanel

let supplied: SourcePanelFactory | null = null

/** Called once by a host package's composition root, before any plugin chrome registers. */
export function setSourcePanel(factory: SourcePanelFactory): void {
  supplied = factory
}

/** This host's answer, or undefined where no host supplied one and the DOM's panel is it. */
export const suppliedSourcePanel = (): SourcePanelFactory | null => supplied

/** Test seam. The factory is module-level, so a suite must not inherit the previous one's host. */
export function _resetSourcePanel(): void {
  supplied = null
}
