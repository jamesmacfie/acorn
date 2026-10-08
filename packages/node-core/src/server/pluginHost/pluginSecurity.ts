import { pluginState, type PluginsBridge } from './state'

/** Counts only. Package names, manifest prose, grant sources and skill text never enter diagnostics. */
export type PluginSecuritySnapshot = {
  packages: number
  executableGrants: number
  developmentEnabled: number
  skillsApproved: number
  skillsUnapproved: number
  pendingReview: number
}

export function pluginSecuritySnapshot(bridge: PluginsBridge): PluginSecuritySnapshot {
  const all = pluginState(bridge).plugins
  const rows = all.filter((row) => row.installed)
  return {
    packages: rows.length,
    executableGrants: rows.filter((row) => row.running && row.active?.permissions.node.exec === true).length,
    developmentEnabled: rows.filter((row) => row.development?.on === true).length,
    skillsApproved: rows.reduce((sum, row) => sum + (row.skills?.skills.filter((skill) => skill.approved && skill.enabled).length ?? 0), 0),
    skillsUnapproved: rows.reduce((sum, row) => sum + (row.skills?.skills.filter((skill) => !skill.approved && skill.enabled).length ?? 0), 0),
    pendingReview: all.filter((row) => !!row.pendingReview).length,
  }
}
