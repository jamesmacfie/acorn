// Host side of rung 2 for loaded Node plugins: one permission-scoped worker realm per package, with
// the already-scoped NodePluginContext as its only authority-bearing object.
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MessageChannel, Worker } from 'node:worker_threads'
import { assertSupportedNodeRuntime } from '@acorn/protocol/nodeRuntime.ts'
import { hostFunctionMode } from './hostCallModes'
import { pluginDbPath, preparePluginDbFiles } from './storage'
import { brokerEnv } from '../core/proc'
import type { NodePlugin, NodePluginContext } from '../pluginHost/types'
import type { NodePermissions } from './manifest'

type Lifecycle = {
  init(ctx: Omit<NodePluginContext, 'storage'>): Promise<void>
  ready?: (ctx: Omit<NodePluginContext, 'storage'>) => Promise<void>
  dispose(): Promise<void>
}

type Handshake =
  | { __acornPlugin: 'ready'; descriptor: unknown; metadata: Record<string, unknown> }
  | { __acornPlugin: 'failed'; error: unknown }

const workerEntrypoint = (): string => {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = import.meta.url.endsWith('.ts')
    ? [join(here, 'nodePluginWorker.ts')]
    : [join(here, 'plugin-worker.js'), join(here, '..', 'plugin-worker.js')]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('the loaded-plugin worker bootstrap is missing from this build')
  return realpathSync(found)
}

const packageRoot = (entry: string): string => {
  let cursor = dirname(entry)
  for (;;) {
    if (existsSync(join(cursor, 'package.json'))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) return dirname(entry)
    cursor = parent
  }
}

const runtimeReadRoots = (bootstrap: string): string[] => {
  // The production worker is a Vite entry whose chunks, Drizzle included, sit under dist
  // (apps/node/externals.ts). The source worker imports adjacent node-core modules and Drizzle as a
  // bare dependency.
  if (!import.meta.url.endsWith('.ts')) return [realpathSync(dirname(bootstrap))]
  const trusted = resolve(dirname(bootstrap), '..')
  const drizzle = packageRoot(fileURLToPath(import.meta.resolve('drizzle-orm')))
  const hostPackage = packageRoot(fileURLToPath(import.meta.url))
  const localDrizzle = join(hostPackage, 'node_modules', 'drizzle-orm')
  const builtinPolicy = fileURLToPath(import.meta.resolve('@acorn/protocol/plugin/nodeBuiltins.ts'))
  // Node reads package exports and resolves the lexical dependency symlink before reading source.
  // Mirror the resolved protocol grant at this alias, without granting the node_modules directory.
  const localProtocol = join(hostPackage, 'node_modules', '@acorn', 'protocol')
  return [
    realpathSync(trusted),
    realpathSync(packageRoot(builtinPolicy)),
    ...(existsSync(localProtocol) ? [localProtocol] : []),
    drizzle,
    realpathSync(drizzle),
    ...(existsSync(localDrizzle) ? [localDrizzle, realpathSync(localDrizzle)] : []),
  ]
}

const unstarted = new WeakMap<NodePlugin, () => Promise<void>>()

/** Terminate a realm the dependency resolver rejected before the host acquired it. */
export function disposeUnstartedPlugin(plugin: NodePlugin): Promise<void> | undefined {
  const dispose = unstarted.get(plugin)
  unstarted.delete(plugin)
  return dispose?.()
}

export async function isolateNodePlugin(options: {
  entrypoint: string
  pluginDir: string
  plugin: string
  dataRoot: string
  migrationsFolder: string | null
  permissions: NodePermissions
}): Promise<NodePlugin> {
  assertSupportedNodeRuntime(process.versions.node)
  // Bundled-only nodes do not need the loaded-plugin RPC transport. Resolve it before acquiring
  // a worker so a failed import cannot strand a native realm.
  const { PluginRpcEndpoint } = await import('./pluginRpc')
  const bootstrap = workerEntrypoint()
  const packageDir = realpathSync(options.pluginDir)
  const read = new Set([bootstrap, packageDir, resolve(options.pluginDir), ...runtimeReadRoots(bootstrap)])
  if (options.migrationsFolder) {
    read.add(resolve(options.migrationsFolder))
    read.add(realpathSync(options.migrationsFolder))
  }
  const write = new Set<string>()
  if (options.migrationsFolder) {
    for (const path of preparePluginDbFiles(options.dataRoot, options.plugin)) {
      // SQLite receives this lexical spelling. Descriptor preflight also needs its exact-file
      // grant when the data root is a host alias, such as /var -> /private/var on macOS.
      read.add(resolve(path))
      write.add(resolve(path))
      read.add(realpathSync(path))
      write.add(realpathSync(path))
    }
  }
  const environment = brokerEnv({})
  const environmentNames = new Set([
    ...(options.permissions.env ?? []),
    ...(options.permissions.files ?? []).map((permission) => permission.env),
  ])
  for (const name of environmentNames) {
    const value = process.env[name]
    if (value !== undefined) environment[name] = value
  }
  const protectedRoot = resolve(options.dataRoot)
  const isProtected = (path: string) => path === protectedRoot || path.startsWith(`${protectedRoot}${sep}`)
  for (const permission of options.permissions.files ?? []) {
    const configured = process.env[permission.env]
    if (!configured) continue
    if (!isAbsolute(configured)) {
      throw new Error(`Plugin '${options.plugin}' file grant ${permission.env} must name an absolute path.`)
    }
    const path = resolve(configured)
    const real = existsSync(path) ? realpathSync(path) : path
    if (isProtected(path) || isProtected(real)) {
      throw new Error(`Plugin '${options.plugin}' file grant ${permission.env} must stay outside acorn's data root.`)
    }
    read.add(path)
    read.add(real)
    if (permission.access === 'read-write') {
      write.add(path)
      const temporary = `${path}.acorn-tmp`
      if (existsSync(temporary) && isProtected(realpathSync(temporary))) {
        throw new Error(`Plugin '${options.plugin}' file grant ${permission.env} has a protected atomic-write sidecar.`)
      }
      read.add(temporary)
      write.add(temporary)
    }
  }

  const execArgv = [
    '--permission',
    ...[...read].map((path) => `--allow-fs-read=${path}`),
    ...[...write].map((path) => `--allow-fs-write=${path}`),
    // Node 26 added network permissions. The supported Node 24 line relies on the bootstrap's raw
    // module deny list and hostname-checking fetch wrapper instead.
    ...((options.permissions.net.length || options.permissions.sockets) && Number(process.versions.node.split('.')[0]) >= 26 ? ['--allow-net'] : []),
    ...(options.permissions.exec ? ['--allow-child-process'] : []),
  ]
  const { port1, port2 } = new MessageChannel()
  const endpoint = new PluginRpcEndpoint(port1, hostFunctionMode)
  const worker = new Worker(bootstrap, {
    workerData: {
      port: port2,
      entrypoint: realpathSync(options.entrypoint),
      pluginDir: packageDir,
      plugin: options.plugin,
      databasePath: pluginDbPath(options.dataRoot, options.plugin),
      migrationsFolder: options.migrationsFolder,
      allowNetwork: options.permissions.net.length > 0,
      allowSockets: options.permissions.sockets,
      networkHosts: [...options.permissions.net],
      allowExec: options.permissions.exec,
    },
    transferList: [port2],
    execArgv,
    env: environment,
  })
  worker.unref()

  const handshake = await new Promise<Handshake>((resolveHandshake, reject) => {
    const onMessage = (message: unknown) => {
      if (typeof message !== 'object' || message === null || !('__acornPlugin' in message)) return
      port1.off('message', onMessage)
      resolveHandshake(message as Handshake)
    }
    port1.on('message', onMessage)
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`plugin worker exited with code ${code}`))
    })
  }).catch((error) => {
    endpoint.close(error instanceof Error ? error : new Error(String(error)))
    void worker.terminate()
    throw error
  })

  if (handshake.__acornPlugin === 'failed') {
    const error = endpoint.decode(handshake.error)
    endpoint.close(error instanceof Error ? error : new Error(String(error)))
    void worker.terminate()
    throw error
  }

  const lifecycle = endpoint.decode(handshake.descriptor, 'plugin') as Lifecycle
  let closed = false
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (closing) return closing
    if (closed) return Promise.resolve()
    closed = true
    endpoint.close(new Error(`Plugin '${options.plugin}' worker stopped.`))
    closing = worker.terminate().then(() => {})
    return closing
  }
  worker.on('error', (error) => {
    if (!closed) endpoint.close(error instanceof Error ? error : new Error(String(error)))
    closed = true
  })
  worker.on('exit', (code) => {
    if (!closed) endpoint.close(new Error(`Plugin '${options.plugin}' worker exited with code ${code}.`))
    closed = true
  })
  let disposing: Promise<void> | undefined
  const plugin: NodePlugin & Record<string, unknown> = {
    ...handshake.metadata,
    name: options.plugin,
    init: (ctx) => lifecycle.init(loadedContext(ctx)),
    ...(lifecycle.ready ? { ready: (ctx: NodePluginContext) => lifecycle.ready!(loadedContext(ctx)) } : {}),
    dispose: () => {
      disposing ??= (async () => {
        if (closed) return close()
        try {
          await lifecycle.dispose()
        } finally {
          unstarted.delete(plugin)
          await close()
        }
      })()
      return disposing
    },
  }
  unstarted.set(plugin, close)
  return plugin
}

// The worker opens its own storage. Project only the loaded contract, since compiled contexts can
// carry additional host methods at runtime even when a caller types them as NodePluginContext.
const loadedContext = (ctx: NodePluginContext): Omit<NodePluginContext, 'storage'> => ({
  name: ctx.name,
  routes: { fetch: ctx.routes.fetch },
  schedules: { register: ctx.schedules.register },
  dataSources: ctx.dataSources,
  taskChecks: ctx.taskChecks,
  runs: ctx.runs,
  audit: ctx.audit,
  extensionPoints: ctx.extensionPoints,
  hooks: ctx.hooks,
  providers: {
    integration: ctx.providers.integration,
    connection: ctx.providers.connection,
    model: ctx.providers.model,
    nodes: ctx.providers.nodes,
    withConnection: ctx.providers.withConnection,
  },
  capabilities: ctx.capabilities,
  core: ctx.core,
  events: {
    send: ctx.events.send,
    status: ctx.events.status,
    worktreeStatus: ctx.events.worktreeStatus,
    repoConfigTrustNotice: ctx.events.repoConfigTrustNotice,
    notice: ctx.events.notice,
    on: ctx.events.on,
  },
  telemetry: ctx.telemetry,
  log: ctx.log,
})
