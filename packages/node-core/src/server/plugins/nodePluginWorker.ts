// Bootstrap for one loaded plugin's Node half. This is a separate Vite entry in production and a
// directly executed TypeScript module in tests. Trusted runtime modules load first; the resolver hook
// is installed before the package's entrypoint is evaluated.
import { builtinModules, createRequire, registerHooks, syncBuiltinESMExports } from 'node:module'
import { realpathSync } from 'node:fs'
import { sep } from 'node:path'
import { workerData, type MessagePort } from 'node:worker_threads'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pluginBuiltinAllowed } from '@acorn/protocol/plugin/nodeBuiltins.ts'
import { pluginFunctionMode } from './functionMode.ts'
import { networkHostAllowed } from './networkHosts.ts'
import { PluginRpcEndpoint, rpcError } from './pluginRpc.ts'
import type { NodePlugin, NodePluginContext } from '../pluginHost/types.ts'
import type { WorkerPluginDatabase } from './workerStorage.ts'

type WorkerOptions = {
  port: MessagePort
  entrypoint: string
  pluginDir: string
  plugin: string
  databasePath: string
  migrationsFolder: string | null
  allowNetwork: boolean
  allowSockets: boolean
  networkHosts: string[]
  allowExec: boolean
}

const options = workerData as WorkerOptions
const openWorkerPluginDb = options.migrationsFolder
  ? (await import('./workerStorage.ts')).openWorkerPluginDb
  : null
const builtinGrants = { sockets: options.allowSockets, exec: options.allowExec }
const builtinAllowed = (specifier: string) => pluginBuiltinAllowed(specifier, builtinGrants)

// Rolldown uses createRequire when an otherwise self-contained ESM bundle contains a CommonJS
// dependency. The package builder rewrites only that generated import to this permission-aware
// require. Exposing the function is safe: direct and generated callers both pass through the same
// builtin family policy, and non-builtin packages cannot escape the package's bundled dependency graph.
const safeRequireSymbol = Symbol.for('acorn.plugin.safe-require.v1')
const nativeRequire = createRequire(import.meta.url)
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')))
Object.defineProperty(globalThis, safeRequireSymbol, {
  configurable: false,
  writable: false,
  value: (specifier: string) => {
    const name = specifier.replace(/^node:/, '')
    if (!builtins.has(name)) {
      throw new Error(`acorn: loaded plugin '${options.plugin}' may not require non-builtin '${specifier}'`)
    }
    if (!builtinAllowed(specifier)) {
      throw new Error(`acorn: loaded plugin '${options.plugin}' may not require '${specifier}'`)
    }
    return nativeRequire(specifier)
  },
})

// Module ownership survives a package edit or removal while the old realm is still serving during
// reload. A failed fresh realpath of the parent must never promote its later imports to trusted.
const pluginModuleUrls = new Set([pathToFileURL(options.entrypoint).href])
registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith('node:') || builtins.has(specifier)) && !builtinAllowed(specifier)) {
      throw new Error(`acorn: loaded plugin '${options.plugin}' may not import '${specifier}'`)
    }
    const resolved = next(specifier, context)
    if (context.parentURL && (pluginModuleUrls.has(context.parentURL) ||
      (context.parentURL.startsWith('file:') && isPluginFile(context.parentURL)))) {
      if (resolved.url.startsWith('node:')) {
        if (!builtinAllowed(resolved.url)) throw new Error(`acorn: loaded plugin '${options.plugin}' may not import '${specifier}'`)
      } else if (!resolved.url.startsWith('file:')) {
        throw new Error(`acorn: loaded plugin '${options.plugin}' dependencies must be package files or approved builtins`)
      } else if (!isPluginFile(resolved.url)) {
        throw new Error(`acorn: loaded plugin '${options.plugin}' may not import files outside its package`)
      } else {
        pluginModuleUrls.add(resolved.url)
      }
    }
    return resolved
  },
})

const pluginPrefix = `${options.pluginDir}${sep}`
function isPluginFile(url: string): boolean {
  try {
    const path = realpathSync(fileURLToPath(url))
    return path === options.pluginDir || path.startsWith(pluginPrefix)
  } catch {
    return false
  }
}

// This API bypasses ESM resolution hooks, so it receives the same builtin family policy.
const getBuiltinModule = process.getBuiltinModule.bind(process)
process.getBuiltinModule = ((specifier: string) => {
  if (!builtinAllowed(specifier)) {
    throw new Error(`acorn: loaded plugin '${options.plugin}' may not load builtin '${specifier}'`)
  }
  return getBuiltinModule(specifier)
}) as typeof process.getBuiltinModule
// Trusted bootstrap dependencies may already have loaded node:process. Synchronize its cached
// named exports before plugin evaluation so every import order receives the guarded accessor.
syncBuiltinESMExports()

const nativeFetch = globalThis.fetch.bind(globalThis)
if (options.allowNetwork) {
  const hosts = new Set(options.networkHosts)
  const anyHost = hosts.has('*')
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(input)
    if (!networkHostAllowed(url.hostname, hosts)) throw new Error(`acorn: loaded plugin '${options.plugin}' may not reach '${url.hostname}'`)
    // An explicit any-host grant also permits redirects to any host. Keep the caller's redirect
    // policy instead of forcing manual redirects on an API client.
    if (anyHost) return nativeFetch(input, init)
    // Never let the native fetch implementation follow a redirect before this wrapper has checked
    // its destination. The plugin may inspect Location and make another fetch, which re-enters the
    // same hostname gate.
    return nativeFetch(input, { ...init, redirect: 'manual' })
  }) as typeof fetch
} else {
  delete (globalThis as Record<string, unknown>).fetch
}
for (const name of ['WebSocket', 'XMLHttpRequest', 'EventSource', 'navigator']) {
  delete (globalThis as Record<string, unknown>)[name]
}

const endpoint = new PluginRpcEndpoint(options.port, pluginFunctionMode)
let database: WorkerPluginDatabase | null = null

try {
  const mod = await import(pathToFileURL(options.entrypoint).href)
  const plugin = (mod as { default?: unknown }).default as Partial<NodePlugin> | undefined
  if (!plugin || typeof plugin !== 'object' || typeof plugin.name !== 'string' || typeof plugin.init !== 'function'
    || (plugin.ready !== undefined && typeof plugin.ready !== 'function')
    || (plugin.dispose !== undefined && typeof plugin.dispose !== 'function')) {
    throw new Error('node entrypoint must default-export { name, init, ready?, dispose? } from an ESM bundle')
  }
  if (plugin.name !== options.plugin) {
    throw new Error(`bundle declares name '${plugin.name}' but the manifest id is '${options.plugin}'`)
  }

  const lifecycle = {
    init: async (encodedContext: unknown) => {
      const remote = endpoint.decode(encodedContext, 'context') as NodePluginContext
      const ctx: NodePluginContext = {
        ...remote,
        storage: (options.migrationsFolder
          ? {
              open: () => {
                database ??= openWorkerPluginDb!(options.databasePath, options.plugin, options.migrationsFolder!)
                return database
              },
            }
          : undefined) as never,
      }
      await plugin.init!(ctx as never)
    },
    ...(plugin.ready
      ? {
          ready: async (encodedContext: unknown) => {
            const remote = endpoint.decode(encodedContext, 'context') as NodePluginContext
            await plugin.ready!({
              ...remote,
              storage: (database
                ? { open: () => database! }
                : options.migrationsFolder
                  ? {
                      open: () => {
                        database ??= openWorkerPluginDb!(options.databasePath, options.plugin, options.migrationsFolder!)
                        return database
                      },
                    }
                  : undefined) as never,
            } as never)
          },
        }
      : {}),
    dispose: async () => {
      try {
        await plugin.dispose?.()
      } finally {
        try {
          database?.close()
        } finally {
          database = null
        }
      }
    },
  }

  options.port.postMessage({
    __acornPlugin: 'ready',
    descriptor: await endpoint.encode(lifecycle, 'plugin'),
    // Preserve plain metadata used by diagnostics and loader tests without allowing an arbitrary
    // instance object to cross realms.
    metadata: Object.fromEntries(
      Object.entries(plugin).filter(([, value]) => typeof value !== 'function' && structuredCloneable(value)),
    ),
  })
} catch (error) {
  options.port.postMessage({ __acornPlugin: 'failed', error: rpcError(error) })
}

function structuredCloneable(value: unknown): boolean {
  try {
    structuredClone(value)
    return true
  } catch {
    return false
  }
}
