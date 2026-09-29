// Core route builders and wire types share this public import path. The subject modules are private;
// the package exports map exposes only this facade to other packages.
export type { ApiError } from './errors.ts'
export { PLUGIN_API_MAJOR } from '../plugin/apiVersion.ts'
export type {
  NodePluginPermissions,
  PluginAgentContextDescriptor,
  PluginAttentionDescriptor,
  PluginChromeAction,
  PluginClientRouteDescriptor,
  PluginCommandAction,
  PluginCommandCategory,
  PluginCommandDescriptor,
  PluginCommandSelectAction,
  PluginContentLinkDescriptor,
  PluginContributions,
  PluginDocumentCompletions,
  PluginDocumentRegion,
  PluginFrameSurface,
  PluginKeybindingDescriptor,
  PluginNodeStatDescriptor,
  PluginPaneRegion,
  PluginRefResolverDescriptor,
  PluginSlotDescriptor,
  PluginSourceDescriptor,
  PluginSourceEmptyState,
  PluginThemeDescriptor,
} from '../plugin/contract.ts'

export * from './api/taskSupport.ts'
export * from './api/integrations.ts'
export * from './api/nodeAdmin.ts'
export * from './api/pluginGrants.ts'
export * from './api/pluginPresentation.ts'
export * from './api/pluginState.ts'
export * from './api/projects.ts'
export * from './api/runtime.ts'
