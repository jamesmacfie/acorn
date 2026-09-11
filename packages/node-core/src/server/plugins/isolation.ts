// Host side of rung 2 for loaded Node plugins: one permission-scoped worker realm per package, with
// the already-scoped NodePluginContext as its only authority-bearing object.
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MessageChannel, Worker } from 'node:worker_threads'
import { PluginRpcEndpoint } from './pluginRpc'
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

const hostFunctionMode = (path: string): 'sync' | 'async' => {
  const sync = [
    /\.routes\.fetch$/,
    /\.(schedules|collections|taskChecks|runs|audit)\.(register|declare|record)$/,
    /\.extensionPoints\.(declare|handle|handlers|open|contribute|entries)$/,
    /\.hooks\.(declare|handle)$/,
    /\.providers\.(integration|connection|nodes)$/,
    /\.capabilities\.(provide|get|require|ids)$/,
    /\.events\.(send|status|worktreeStatus|repoConfigTrustNotice|notice|on)$/,
    /\.(telemetry|log)\./,
    /\.core\.identity\.active$/,
    /\.core\.fs\.(isContainedPath|isValidRepoIdent|resolveInRoot)$/,
    /\.core\.telemetry\.(enabled|onBatch)$/,
  ]
  return sync.some((pattern) => pattern.test(path)) ? 'sync' : 'async'
}

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
  // The source worker imports adjacent node-core modules. The production worker is a Vite entry whose
  // trusted chunks sit under dist. Drizzle remains a bare dependency in both layouts.
  const trusted = import.meta.url.endsWith('.ts') ? resolve(dirname(bootstrap), '..') : dirname(bootstrap)
  const drizzle = packageRoot(fileURLToPath(import.meta.resolve('drizzle-orm')))
  const localDrizzle = join(packageRoot(fileURLToPath(import.meta.url)), 'node_modules', 'drizzle-orm')
  return [
    realpathSync(trusted),
    dirname(drizzle),
    drizzle,
    realpathSync(drizzle),
    ...(existsSync(localDrizzle) ? [localDrizzle, realpathSync(localDrizzle)] : []),
  ]
}

const unstarted = new WeakMap<NodePlugin, () => void>()

/** Terminate a realm the dependency resolver rejected before the host acquired it. */
export function disposeUnstartedPlugin(plugin: NodePlugin): void {
  unstarted.get(plugin)?.()
  unstarted.delete(plugin)
}

export async function isolateNodePlugin(options: {
  entrypoint: string
  pluginDir: string
  plugin: string
  dataRoot: string
  migrationsFolder: string | null
  permissions: NodePermissions
}): Promise<NodePlugin> {
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
    ...(options.permissions.net.length && Number(process.versions.node.split('.')[0]) >= 26 ? ['--allow-net'] : []),
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
  const close = () => {
    if (closed) return
    closed = true
    endpoint.close(new Error(`Plugin '${options.plugin}' worker stopped.`))
    void worker.terminate()
  }
  worker.on('error', (error) => {
    if (!closed) endpoint.close(error instanceof Error ? error : new Error(String(error)))
    closed = true
  })
  worker.on('exit', (code) => {
    if (!closed) endpoint.close(new Error(`Plugin '${options.plugin}' worker exited with code ${code}.`))
    closed = true
  })
  const plugin: NodePlugin & Record<string, unknown> = {
    ...handshake.metadata,
    name: options.plugin,
    init: (ctx) => lifecycle.init(withoutStorage(ctx)),
    ...(lifecycle.ready ? { ready: (ctx: NodePluginContext) => lifecycle.ready!(withoutStorage(ctx)) } : {}),
    dispose: async () => {
      try {
        await lifecycle.dispose()
      } finally {
        close()
      }
    },
  }
  unstarted.set(plugin, close)
  return plugin
}

const withoutStorage = (ctx: NodePluginContext): Omit<NodePluginContext, 'storage'> => {
  const { storage: _storage, ...remote } = ctx
  return remote
}
