import type { Component } from 'solid-js'
import { Registry } from './registry'

export type ProjectImporterProps = {
  onClose: () => void
  /**
   * One import finished. `projectIds` names what it produced, which a host cannot reliably work out
   * for itself: an import may repair an existing project rather than create one, so diffing the
   * project list before and after silently loses it. Hosts that only need "something changed" ignore
   * the argument.
   */
  onImported: (projectIds?: readonly string[]) => void
  /**
   * Whether the importer draws its own close control. False where the host already owns the way out —
   * the first-run wizard has a back button in its footer, and two of them read as a mistake.
   */
  showClose?: boolean
}

export type ProjectImporterContribution = {
  id: string
  label: string
  glyph: string
  component: Component<ProjectImporterProps>
}

// Project discovery is provider-owned. The shell supplies the host surface and lifecycle callbacks;
// each plugin owns its candidate list, action protocol, and result presentation.
export const projectImporterRegistry = new Registry<ProjectImporterContribution>('project importer')
