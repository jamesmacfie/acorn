// The example harness (docs/site/plugin-guides.md): install an example plugin the way the Node reads
// it, start its Node half on the real host context, and run its client bundle through the same
// handshake the host performs. The examples test and the site's pictures both go through here, so a
// picture on a guide is what the tested example draws.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { build } from 'vite'
import solid from 'vite-plugin-solid'
import { parsePluginManifest } from '@acorn/node-core/server/plugins'
import { resolvePluginFetch } from '@acorn/node-core/server/routes/registry.ts'
import { makeTestNodeContext, makeTestRequestContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { sandboxMessage, type TreeMutation, type TreeNode } from '@acorn/protocol/tree/messages.ts'

export const EXAMPLES = resolve(import.meta.dirname, '..')

type Parsed = Extract<ReturnType<typeof parsePluginManifest>, { ok: true }>
type Manifest = Parsed['manifest']
export type Example = { path: string; dir: string; manifest: Manifest }

/** Reads `examples/plugins/<path>/acorn-plugin.json` and parses it with the Node's own parser, cross-field
 *  rules included. Throws the Node's reason when it refuses. */
export function readExample(path: string): Example {
  const dir = join(EXAMPLES, path)
  const result = parsePluginManifest(JSON.parse(readFileSync(join(dir, 'acorn-plugin.json'), 'utf8')))
  if (!result.ok) throw new Error(`${path}/acorn-plugin.json: ${result.reason}`)
  return { path, dir, manifest: result.manifest }
}

type Principal = Parameters<typeof makeTestRequestContext>[0]['principal']

export type NodeHalf = {
  /** Calls a route by its full path, `/v1/p/<id>/...`, as the host's dispatcher does. The caller is the
   *  owner's device unless `principal` says otherwise, such as an agent's task credential. */
  call(
    path: string,
    init?: { method?: string; body?: unknown; headers?: Record<string, string>; principal?: Principal },
  ): Promise<Response>
  /** The context the Node half was started with, for seeding core's rows or reading what it registered. */
  ctx: TestNodeContext
  cleanup(): Promise<void>
}

let loads = 0

/** Starts the example's Node half with the testkit's context, which is the one the host builds, the
 *  manifest's own Node permissions and event grants, and its own migrations. `userId` binds the Node to an owner, which
 *  `ctx.core.identity.active()` then answers. */
export async function startNode(example: Example, options: { userId?: string } = {}): Promise<NodeHalf> {
  const { id, node, permissions, migrations } = example.manifest
  if (!node) throw new Error(`${example.path} has no Node half`)
  // A fresh module per start, so in-memory state from one test doesn't leak into the next.
  const url = `${pathToFileURL(join(example.dir, node)).href}?load=${++loads}`
  const plugin = (await import(url)).default as {
    name: string
    init(ctx: unknown): unknown
    ready?(ctx: unknown): unknown
    dispose?(): unknown
  }
  const ctx = makeTestNodeContext({
    plugin,
    permissions: permissions.node,
    events: permissions.events,
    ...(migrations ? { migrations: join(example.dir, migrations) } : {}),
    ...(options.userId ? { userId: options.userId } : {}),
  })
  await plugin.init(ctx)
  await plugin.ready?.(ctx)
  const device = await makeTestRequestContext({ plugin: id, env: ctx.env })
  return {
    ctx,
    async call(path, init = {}) {
      const target = new URL(path, 'https://node.invalid')
      const match = resolvePluginFetch(id, target.pathname)
      if (!match) return new Response('not found', { status: 404 })
      target.pathname = target.pathname.slice(match.mount.length) || '/'
      const method = init.method ?? 'GET'
      const body = init.body === undefined ? {} : { body: JSON.stringify(init.body) }
      const request = init.principal
        ? await makeTestRequestContext({ plugin: id, env: ctx.env, principal: init.principal })
        : device
      return match.fetch(new Request(target, { method, headers: init.headers, ...body }), request)
    },
    async cleanup() {
      await plugin.dispose?.()
      ctx.cleanup()
    },
  }
}

/** The example's client bundle as the host receives it. A hand-written `client.js` is read as it is.
 *  A bundled example is built with its own Vite config's Solid preset, against this checkout's SDK
 *  source, which is what lets a picture redraw without packing the SDK first. */
export async function clientBundle(example: Example): Promise<string> {
  const client = example.manifest.client
  if (!client) throw new Error(`${example.path} has no client bundle`)
  if (!existsSync(join(example.dir, 'vite.config.ts'))) return readFileSync(join(example.dir, client), 'utf8')
  const out = mkdtempSync(join(tmpdir(), `${example.manifest.id}-bundle-`))
  try {
    const sdk = join(EXAMPLES, '../../packages/plugin-sdk/src')
    await build({
      root: example.dir,
      configFile: false,
      logLevel: 'error',
      plugins: [solid({ solid: { generate: 'universal', moduleName: 'acorn-plugin-sdk/remote' } })],
      resolve: {
        alias: [
          { find: /^acorn-plugin-sdk\/remote$/, replacement: join(sdk, 'remote/solid.ts') },
          { find: /^acorn-plugin-sdk$/, replacement: join(sdk, 'index.ts') },
        ],
        dedupe: ['solid-js'],
      },
      build: {
        lib: { entry: join(example.dir, 'src/client.tsx'), formats: ['es'], fileName: () => 'client.js' },
        outDir: out,
      },
    })
    return readFileSync(join(out, 'client.js'), 'utf8')
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

type Mounted = {
  /** Every batch the tree sent for its slot, in order. */
  batches: TreeMutation[][]
  /** The tree as the host holds it after those batches. */
  roots(): TreeNode[]
  /** Bridge requests other than `api`, such as `ui` and `state`, each answered with success. */
  effects: Record<string, unknown>[]
  /** `tree:host-request` messages, each answered with success. */
  hostRequests: Record<string, unknown>[]
  failed: string | null
  /** Sends a kit event to the first node `find` picks, as the host does when someone presses it. */
  fire(find: (node: TreeNode) => boolean, event?: string, payload?: unknown): Promise<void>
  unmount(): void
}

export type Worker = {
  entries: string[]
  /** Mounts one entry, answers its bridge from `node`, and waits until it stops drawing. */
  mount(entry: string, options?: { props?: object; context?: object; node?: NodeHalf }): Promise<Mounted>
  close(): void
}

/** Runs a client bundle the way the host's worker does: `{ acornBridge: 1 }` with a bootstrap bridge
 *  and a tree port, then one scoped bridge per mount. */
export async function startWorker(source: string): Promise<Worker> {
  let hello: ((event: { data: unknown; ports: MessagePort[] }) => void) | undefined
  runInNewContext(source, {
    addEventListener: (_kind: string, listener: typeof hello) => {
      hello = listener
    },
    TextDecoder,
    TextEncoder,
    URLSearchParams,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  })
  if (!hello) throw new Error('The bundle never listened for the bridge handshake')
  const bootstrap = new MessageChannel()
  const tree = new MessageChannel()
  const ports = [bootstrap.port1, tree.port1]
  const listeners = new Set<(message: Record<string, unknown>) => void>()
  tree.port1.on('message', (message: Record<string, unknown>) => listeners.forEach((listener) => listener(message)))
  const ready = new Promise<{ entries?: string[] }>((done) =>
    listeners.add((message) => message.kind === 'tree:ready' && done(message)),
  )
  hello({ data: { acornBridge: 1 }, ports: [bootstrap.port2, tree.port2] })
  bootstrap.port1.postMessage({ kind: 'ready', context: {} })
  const { entries = [] } = await ready
  let slots = 0

  return {
    entries,
    async mount(entry, { props = {}, context = {}, node } = {}) {
      const slot = `slot-${++slots}`
      const scoped = new MessageChannel()
      ports.push(scoped.port1)
      const mounted: Mounted = {
        batches: [],
        roots: () => applyBatches(mounted.batches),
        effects: [],
        hostRequests: [],
        failed: null,
        fire: async (find, event = 'onPress', payload = null) => {
          const target = mounted.roots().flatMap(flatten).find(find)
          const handler = (target?.props[event] as { $handler?: number } | undefined)?.$handler
          if (handler === undefined) throw new Error(`No node with an ${event} handler matched`)
          tree.port1.postMessage({ kind: 'tree:event', slot, handler, event, payload })
          await settle()
        },
        unmount: () => tree.port1.postMessage({ kind: 'tree:unmount', slot }),
      }
      let pending = 0
      let messages = 0
      listeners.add((message) => {
        if (message.slot !== slot) return
        messages += 1
        // The host parses every message before it draws, and drops a batch it refuses whole.
        const parsed = sandboxMessage.safeParse(message)
        if (!parsed.success) mounted.failed = `refused ${String(message.kind)}: ${parsed.error.message}`
        else if (message.kind === 'tree:batch') mounted.batches.push(message.ops as TreeMutation[])
        if (message.kind === 'tree:failed') mounted.failed = String(message.message)
        if (message.kind === 'tree:host-request') {
          mounted.hostRequests.push(message)
          tree.port1.postMessage({ kind: 'tree:host-reply', slot, id: message.id, ok: true, body: null })
        }
      })
      scoped.port1.on('message', async (message: Record<string, unknown>) => {
        messages += 1
        if (message.kind === 'api' && typeof message.id === 'number') {
          pending += 1
          scoped.port1.postMessage(await answer(node, message))
          pending -= 1
        } else if (typeof message.id === 'number') {
          mounted.effects.push(message)
          scoped.port1.postMessage({ id: message.id, ok: true, status: 200, body: null })
        }
      })
      tree.port1.postMessage({ kind: 'tree:mount', slot, entry, props, context, bridgePort: scoped.port2 }, [
        scoped.port2,
      ])
      scoped.port1.postMessage({ kind: 'ready', context })
      // Drawn once nothing has arrived for a few turns and no route call is outstanding.
      const settle = async () => {
        let seen = -1
        for (let turn = 0; turn < 200 && (seen !== messages || pending > 0); turn += 1) {
          seen = messages
          await new Promise((done) => setTimeout(done, 15))
        }
      }
      await settle()
      return mounted
    },
    close: () => ports.forEach((port) => port.close()),
  }
}

async function answer(node: NodeHalf | undefined, message: Record<string, unknown>) {
  const id = message.id as number
  const refuse = (status: number, text: string) => ({
    id,
    ok: false,
    error: { code: status === 404 ? 'not_found' : 'internal', message: text, requestId: '', retryable: false },
  })
  if (!node) return refuse(404, 'This mount has no Node half to answer it')
  const response = await node.call(String(message.path), { method: String(message.method), body: message.body })
  const text = await response.text()
  if (!response.ok) return refuse(response.status, text)
  return { id, ok: true, status: response.status, body: text ? JSON.parse(text) : null }
}

/** Applies batches the way the host's tree store does, so a test can read and press what's drawn. */
function applyBatches(batches: TreeMutation[][]): TreeNode[] {
  const roots: TreeNode[] = []
  const nodes = new Map<string, TreeNode>()
  const parentOf = new Map<string, TreeNode[]>()
  const index = (node: TreeNode, siblings: TreeNode[]) => {
    nodes.set(node.id, node)
    parentOf.set(node.id, siblings)
    node.children.forEach((child) => index(child, node.children))
  }
  const detach = (id: string) => {
    const siblings = parentOf.get(id)
    const at = siblings?.findIndex((node) => node.id === id) ?? -1
    return at >= 0 ? siblings!.splice(at, 1)[0] : undefined
  }
  for (const op of batches.flat()) {
    if (op.op === 'insert') {
      const node = structuredClone(op.node)
      const siblings = op.parent === null ? roots : nodes.get(op.parent)!.children
      siblings.splice(op.index, 0, node)
      index(node, siblings)
    } else if (op.op === 'remove') detach(op.id)
    else if (op.op === 'patch') Object.assign(nodes.get(op.id)!.props, op.props)
    else if (op.op === 'text') nodes.get(op.id)!.props.value = op.value
    else {
      const node = detach(op.id)!
      const siblings = op.parent === null ? roots : nodes.get(op.parent)!.children
      siblings.splice(op.index, 0, node)
      parentOf.set(node.id, siblings)
    }
  }
  return roots
}

export const flatten = (node: TreeNode): TreeNode[] => [node, ...node.children.flatMap(flatten)]

/** The text a node and its children draw, joined, for asserting on what a reader sees. */
export const textOf = (node: TreeNode): string =>
  node.type === '#text' ? String(node.props.value) : node.children.map(textOf).filter(Boolean).join(' ')
