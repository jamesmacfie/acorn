import type { Component } from 'solid-js'
import { Registry } from './registry'

export type ProjectImporterProps = {
  onClose: () => void
  onImported: () => void
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
