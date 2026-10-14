import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserHandoffResolution, matchHandoffPage, taskAddressList } from '@acorn/protocol/plugin/handoffs.ts'
import { isolateNodePlugin } from './isolation'
import { installedPluginInfo, loadExternalPlugins, loadedPluginBinding, pluginInstallDir } from './loader'
import { PLUGIN_API_MAJOR, pluginManifestSchema } from './manifest'
import type { CompiledNodePluginContext, PluginFetchHandler } from '../pluginHost/types'

// The browser handoff contract from a stranger's side: a package on disk declares a site button and
// serves its resolve route, with no browser code in it at all. The loader holds the declaration to the
// manifest rules, and the route's answer parses against the same schema the extension's host applies.
// docs/plugin-authoring/browser-handoffs.md.

const ID = 'tracker'
const fixture = fileURLToPath(new URL('./__fixtures__/handoffPlugin.mjs', import.meta.url))

const handoff = {
  id: 'item',
  label: 'Open in Acorn',
  match: ['https://tracker.example/items/{id}'],
  anchors: ['.item-header > .actions'],
  resolve: `/v1/p/${ID}/handoff/resolve`,
}
const taskAddresses = `/v1/p/${ID}/task-addresses`

const manifest = (over: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Tracker',
  version: '1.0.0',
  baseline: 'acorn-1',
  apiVersion: PLUGIN_API_MAJOR,
  node: './dist/node.js',
  contributions: { browserHandoffs: [handoff], taskAddresses },
  ...over,
})

let root = ''
const install = (body: unknown = manifest()) => {
  const target = join(pluginInstallDir(root), ID)
  mkdirSync(join(target, 'dist'), { recursive: true })
  writeFileSync(join(target, 'acorn-plugin.json'), JSON.stringify(body))
  writeFileSync(join(target, 'dist', 'node.js'), 'export default { name: "tracker", init: () => {} }\n')
}
const load = async (body?: unknown) => {
  install(body)
  return loadExternalPlugins(root, { builtins: [] })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acorn-browser-handoffs-'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('a loaded plugin declaring a browser handoff', () => {
  it('loads with its declaration on the binding the host registers', async () => {
    const result = await load()
    expect(result.failures).toEqual([])
    expect(loadedPluginBinding(result.loaded[0]!).browserHandoffs).toEqual([handoff])
    expect(loadedPluginBinding(result.loaded[0]!).taskAddresses).toBe(taskAddresses)
    expect(installedPluginInfo(result.installed[0]!).contributions.browserHandoffs).toEqual([handoff])
  })

  it.each([
    ['a route outside its namespace', { resolve: '/v1/p/agents/sessions' }, /route must be inside \/v1\/p\/tracker\//],
    ['an http pattern', { match: ['http://tracker.example/items/{id}'] }, /https/],
    ['a wildcard path', { match: ['https://tracker.example/*'] }, /literal/],
    ['a CSS rule as an anchor', { anchors: ['a { color: red }'] }, /CSS selector/],
    ['markup as an anchor', { anchors: ['<img src=x>'] }, /CSS selector/],
    ['an overlong label', { label: 'x'.repeat(41) }, /label/],
  ])('refuses %s', async (_name, change, reason) => {
    const result = await load(manifest({ contributions: { browserHandoffs: [{ ...handoff, ...change }] } }))
    expect(result.installed).toEqual([])
    expect(result.failures[0]!.reason).toMatch(reason)
  })

  it('refuses a task address route outside its namespace, or with no node half to serve it', async () => {
    const outside = await load(manifest({ contributions: { taskAddresses: '/v1/core/tasks' } }))
    expect(outside.failures[0]!.reason).toMatch(/route must be inside \/v1\/p\/tracker\//)
    const parsed = pluginManifestSchema.safeParse(manifest({ node: undefined, contributions: { taskAddresses } }))
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
      'task addresses come from a node route; declare `node` in the manifest',
    ])
  })

  it('refuses a duplicate id, too many handoffs, and a handoff with no node half to serve it', async () => {
    const duplicate = await load(manifest({ contributions: { browserHandoffs: [handoff, handoff] } }))
    expect(duplicate.failures[0]!.reason).toMatch(/duplicate contribution id 'item'/)
    const many = Array.from({ length: 5 }, (_, index) => ({ ...handoff, id: `item-${index}` }))
    const tooMany = await load(manifest({ contributions: { browserHandoffs: many } }))
    expect(tooMany.failures[0]!.reason).toMatch(/browserHandoffs/)
    const parsed = pluginManifestSchema.safeParse(manifest({ node: undefined }))
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      'a browser handoff calls a node route; declare `node` in the manifest',
    )
  })

  it('serves a resolution and task addresses from its own worker that pass the shared schemas', async () => {
    const parsed = pluginManifestSchema.parse(manifest())
    const routes = new Map<string, PluginFetchHandler>()
    // The fixture registers two routes; everything else the worker projects is inert here.
    const ctx = {
      routes: {
        fetch: (handler: PluginFetchHandler, options: { prefix: string }) => void routes.set(options.prefix, handler),
      },
      schedules: {},
      providers: {},
      events: {},
    } as unknown as CompiledNodePluginContext
    const plugin = await isolateNodePlugin({
      entrypoint: fixture,
      pluginDir: dirname(fixture),
      plugin: ID,
      dataRoot: root,
      migrationsFolder: null,
      permissions: parsed.permissions.node,
    })
    try {
      await plugin.init(ctx)
      const url = 'https://tracker.example/items/42/'
      const captures = matchHandoffPage(parsed.contributions.browserHandoffs[0]!, url)
      expect(captures).toEqual({ id: '42' })
      const asOwner = { userId: 'owner', principal: { kind: 'device', userId: 'owner' }, providers: {} } as never
      const response = await routes.get('/handoff')!(
        new Request('https://acorn.invalid/resolve', { method: 'POST', body: JSON.stringify({ url, captures }) }),
        asOwner,
      )
      const resolution = browserHandoffResolution.parse(await response.json())
      expect(resolution.items).toMatchObject([
        { identifier: 'TRK-42', projects: ['project-1'], seed: { origin: 'tracker' } },
      ])
      const addresses = await routes.get('/task-addresses')!(new Request('https://acorn.invalid/'), asOwner)
      expect(taskAddressList.parse(await addresses.json()).addresses).toEqual([
        {
          taskId: 'task-1',
          origin: 'https://tracker-app.localhost:5104',
          label: 'Tracker app',
          state: 'running',
          severity: 'info',
        },
      ])
    } finally {
      await plugin.dispose?.()
    }
  })
})
