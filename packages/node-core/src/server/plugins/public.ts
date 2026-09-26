export { DEV_BUILD_MARKER, reconcileBundledPlugins } from './bundled.ts'
export {
  bundledPluginStatePath, markPluginUserManaged, readBundledPluginState, userManagedPluginIds,
} from './bundledState.ts'
export { disabledPluginsStore } from './disabled.ts'
export { installPlugin, pluginDir, pluginInstallRoot, uninstallPlugin, updatePlugin } from './installer.ts'
export {
  installedPluginInfo, loadExternalPlugins, pluginInstallDir, readClientBundle, snapshotActivePlugin,
  scanInstalled,
} from './loader.ts'
export type { ActivePluginSnapshot, InstalledPlugin, LoadedPlugin, PluginLoadFailure } from './loader.ts'
export { PLUGIN_API_MAJOR, parsePluginManifest, readPluginManifest } from './manifest.ts'
export { createPluginReloader } from './reload.ts'
export { pluginDbPath } from './storage.ts'
export type { PluginDatabase } from './storage.ts'
