import type { Component } from 'solid-js'
import type { Workspace } from '../../../infra/queries'
import { hasHostCapability, type HostCapabilityRequirement } from '../../../infra/node/hostCapabilities'
import { Registry } from '../../../kit/lib/registry'

export type SettingsPageContext = {
  workspace?: Workspace
  onWorkspaceDeleted: () => void
}

export type SettingsContribution = {
  id: string
  label: string
  title?: string
  group: 'general' | 'workspace'
  order: number
  requires?: HostCapabilityRequirement
  component: Component<{ context: SettingsPageContext }>
}

export const settingsRegistry = new Registry<SettingsContribution>('settings')
export const settingsContributions = (): readonly SettingsContribution[] =>
  [...settingsRegistry.entries()]
    .filter((page) => hasHostCapability(page.requires))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
