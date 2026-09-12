// Which component this host draws a descriptor source's rail list with.
//
// The third seam of this shape, after `KIT_COMPONENTS` and `layouts/table.ts`, and it is here for the
// same reason both of those are: `chromeRegister.ts` named `ChromeSourcePanel` directly, and that
// component is DOM all the way down — `<main class="panes">`, `<section>`, `<span>`, `Dynamic` from
// `solid-js/web` and the DOM kit's primitives. Registering it on a cell host handed the reconciler a
// `main` and it refused, so selecting Linear or any other descriptor source in `acorn` threw
// "[Reconciler] Unknown component type: main" rather than drawing a list
// (docs/tui.md § The host switch).
//
// A whole contribution rather than a component, because the two hosts do not put the halves in the
// same place: the desktop draws one surface across the window, and the terminal puts the list in its
// Browse panel and the detail in the main one (docs/tui.md § The screen). Both shapes are already in
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
