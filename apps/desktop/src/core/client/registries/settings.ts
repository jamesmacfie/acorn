import type { Component } from 'solid-js'
import type { Workspace } from '../queries'
import { hasClientCapability, type ClientCapabilityRequirement } from '../capabilities'
import { Registry } from './registry'

export type SettingsPageContext = {
  workspace?: Workspace
  onPermissions: () => void | Promise<void>
  onWorkspaceDeleted: () => void
}

export type SettingsContribution = {
  id: string
  label: string
  title?: string
  group: 'general' | 'workspace'
  order: number
  requires?: ClientCapabilityRequirement
  component: Component<{ context: SettingsPageContext }>
}

export const settingsRegistry = new Registry<SettingsContribution>('settings')
export const settingsContributions = (): readonly SettingsContribution[] =>
  [...settingsRegistry.entries()]
    .filter((page) => hasClientCapability(page.requires))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
