// Bootstrap for one loaded plugin's Node half. This is a separate Vite entry in production and a
// directly executed TypeScript module in tests. Trusted runtime modules load first; the resolver hook
// is installed before the package's entrypoint is evaluated.
import { registerHooks } from 'node:module'
import { realpathSync } from 'node:fs'
import { sep } from 'node:path'
import { workerData, type MessagePort } from 'node:worker_threads'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pluginFunctionMode } from './functionMode.ts'
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
  networkHosts: string[]
  allowExec: boolean
}

const options = workerData as WorkerOptions
const openWorkerPluginDb = options.migrationsFolder
  ? (await import('./workerStorage.ts')).openWorkerPluginDb
  : null
const denied = new Set([
  'cluster', 'module', 'vm', 'inspector', 'repl', 'sqlite', 'worker_threads',
  // Raw sockets cannot enforce a manifest host list. Networked plugins use the wrapped fetch below.
  'net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'quic',
])
if (!options.allowExec) denied.add('child_process')

registerHooks({
  resolve(specifier, context, next) {
    if (denied.has(specifier.replace(/^node:/, ''))) {
      throw new Error(`acorn: loaded plugin '${options.plugin}' may not import '${specifier}'`)
    }
    const resolved = next(specifier, context)
    if (context.parentURL?.startsWith('file:') && isPluginFile(context.parentURL)
      && typeof resolved.url === 'string' && resolved.url.startsWith('file:') && !isPluginFile(resolved.url)) {
      throw new Error(`acorn: loaded plugin '${options.plugin}' may not import files outside its package`)
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

// This API bypasses ESM resolution hooks, so it receives the same builtin deny list.
const getBuiltinModule = process.getBuiltinModule.bind(process)
process.getBuiltinModule = ((specifier: string) => {
  if (denied.has(specifier.replace(/^node:/, ''))) {
    throw new Error(`acorn: loaded plugin '${options.plugin}' may not load builtin '${specifier}'`)
  }
  return getBuiltinModule(specifier)
}) as typeof process.getBuiltinModule

const nativeFetch = globalThis.fetch.bind(globalThis)
if (options.allowNetwork) {
  const hosts = new Set(options.networkHosts)
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(input)
    if (!hosts.has(url.hostname)) throw new Error(`acorn: loaded plugin '${options.plugin}' may not reach '${url.hostname}'`)
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
