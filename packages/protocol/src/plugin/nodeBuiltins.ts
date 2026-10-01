/** Public builtin families available to loaded code. Unknown and internal names fail closed.
 * Filesystem access still depends on the worker's exact Node permission grants. */
const safeFamilies = new Set([
  'assert', 'async_hooks', 'buffer', 'console', 'constants', 'crypto', 'diagnostics_channel',
  'domain', 'events', 'fs', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'stream', 'string_decoder', 'timers', 'trace_events', 'tty', 'url', 'util', 'v8', 'zlib',
])
const socketFamilies = new Set(['net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'quic'])

export type PluginBuiltinGrants = { sockets: boolean; exec: boolean }

/** Use for resolved ESM builtins, scoped CommonJS require, and process.getBuiltinModule alike. */
export function pluginBuiltinAllowed(specifier: string, grants: PluginBuiltinGrants): boolean {
  const name = specifier.replace(/^node:/, '')
  const family = name.split('/', 1)[0]!
  if (!family || family.startsWith('_') || family === 'internal') return false
  if (socketFamilies.has(family)) return grants.sockets
  if (family === 'child_process') return grants.exec
  return safeFamilies.has(family)
}
