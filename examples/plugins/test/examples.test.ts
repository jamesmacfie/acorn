// Every example plugin, installed and run the way the Node and the host run it (docs/site/plugin-guides.md):
// its manifest parses with the Node's own parser, every route it names answers, and every tree entry
// it names mounts through the bridge handshake and draws. The cases after that check what each guide
// says the example does.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TreeNode } from '@acorn/protocol/tree/messages.ts'
import {
  clientBundle,
  EXAMPLES,
  flatten,
  readExample,
  startNode,
  startWorker,
  textOf,
  type Example,
  type NodeHalf,
} from './harness.ts'
import { copyNodeTypes, linkTool, run, TSC, unpackPublishedPackage } from './packed.ts'

/** Every folder under examples/plugins with a manifest, one level of nesting allowed for a pair. */
const PATHS = readdirSync(EXAMPLES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !['node_modules', 'test'].includes(entry.name))
  .flatMap((entry) =>
    existsSync(join(EXAMPLES, entry.name, 'acorn-plugin.json'))
      ? [entry.name]
      : readdirSync(join(EXAMPLES, entry.name)).map((child) => `${entry.name}/${child}`),
  )
  .filter((path) => existsSync(join(EXAMPLES, path, 'acorn-plugin.json')))

/** The props a host passes each entry that needs some to draw. An entry not listed mounts with none. */
const PROPS: Record<string, Record<string, object>> = {
  'acme-switcher': {
    switcher: {
      task: { id: 't1', title: 'Retry webhooks', projectId: 'p1' },
      maximized: null,
      panes: [
        // A pane with no shortcut sends none, which is the shape the host passes.
        { id: 'agents', label: 'Agent', icon: 'bot', shown: true, pinned: true, shortcut: undefined, markers: [] },
        { id: 'git', label: 'Changes', icon: 'git-branch', shown: true, pinned: false, shortcut: '⌘2', markers: [] },
        {
          id: 'acme-tracker',
          label: 'Tracker',
          icon: 'list-todo',
          shown: false,
          pinned: false,
          markers: [{ id: 'm1', label: 'Linked to an Acme issue', tone: 'accent', placements: ['top-end'] }],
        },
      ],
    },
  },
  'acme-points/acme-board': { card: { projectId: 'p1', item: 'c1' }, board: { taskId: 't1' } },
  'acme-points/acme-links': { summary: { surface: 'card', projectId: 'p1', item: 'c1' } },
  'acme-review': {
    pane: { taskId: 't1', projectId: 'p1' },
    toolCard: {
      tool: { title: 'List review files', status: 'completed', output: '{"files":["src/a.ts"]}' },
      taskId: 't1',
    },
    interrupt: { session: { id: 's1', running: true } },
    csvMedia: { taskId: 't1', sessionId: 's1', media: { kind: 'artifact', id: 'a1' } },
    csvFile: { taskId: 't1', path: 'rates.csv', text: 'region,rate\neu,20\n', revision: 1 },
    docsPreview: { url: 'https://docs.example.com/guide/review' },
    issueReview: { surface: 'linear-issue', item: 'ENG-1' },
    checklist: { blockId: 'b1', language: 'review', text: 'src/a.ts\nsrc/b.ts', revision: 1 },
  },
}

/** Every string in the manifest that names one of the plugin's own routes. */
function namedRoutes(example: Example): string[] {
  const prefix = `/v1/p/${example.manifest.id}/`
  const found = new Set<string>()
  const walk = (value: unknown): void => {
    if (typeof value === 'string' && value.startsWith(prefix)) found.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(example.manifest.contributions)
  return [...found].sort()
}

/** Every tree entry the manifest names: pane and panel regions, rail source trees, and extensions. */
function namedEntries(example: Example): string[] {
  const {
    frames = [],
    sources = [],
    extensions = [],
  } = example.manifest.contributions as {
    frames?: { regions?: Record<string, unknown> }[]
    sources?: { tree?: { list: string; detail: string } }[]
    extensions?: { remote?: string }[]
  }
  const entries = [
    ...frames.flatMap((frame) =>
      Object.values(frame.regions ?? {}).flatMap((region) =>
        region && typeof region === 'object' && 'entry' in region ? [String(region.entry)] : [],
      ),
    ),
    ...sources.flatMap((source) => (source.tree ? [source.tree.list, source.tree.detail] : [])),
    ...extensions.flatMap((extension) => extension.remote ?? []),
  ]
  return [...new Set(entries)].sort()
}

let node: NodeHalf | undefined
afterEach(async () => {
  await node?.cleanup()
  node = undefined
})

describe.each(PATHS)('%s', (path) => {
  const example = readExample(path)

  it.runIf(example.manifest.node)('answers every route its manifest names', async () => {
    node = await startNode(example)
    // A route is served when GET or POST answers differently from a path nobody names. Comparing
    // with that, not with a 404, lets a served route answer 404 for an item it doesn't know.
    const answer = async (path: string, init?: { method: string; body: object }) => {
      const response = await node!.call(path, init)
      return `${response.status} ${await response.text()}`
    }
    const unnamed = `/v1/p/${example.manifest.id}/no-such-route`
    const missing = [await answer(unnamed), await answer(unnamed, { method: 'POST', body: {} })]
    for (const route of namedRoutes(example)) {
      const answers = [await answer(route), await answer(route, { method: 'POST', body: {} })]
      expect(answers, route).not.toEqual(missing)
    }
  })

  it.runIf(example.manifest.client && namedEntries(example).length > 0)(
    'mounts and draws every tree entry its manifest names',
    async () => {
      if (example.manifest.node) node = await startNode(example)
      const worker = await startWorker(await clientBundle(example))
      try {
        expect([...worker.entries].sort()).toEqual(namedEntries(example))
        for (const entry of worker.entries) {
          const mounted = await worker.mount(entry, { props: PROPS[path]?.[entry], node })
          expect(mounted.failed, entry).toBe(null)
          expect(mounted.roots().length, entry).toBeGreaterThan(0)
        }
      } finally {
        worker.close()
      }
    },
  )
})

/** Mounts one entry of one example against its own Node half. */
async function mount(path: string, entry: string, options: { props?: object; context?: object } = {}) {
  const example = readExample(path)
  if (example.manifest.node) node = await startNode(example)
  const worker = await startWorker(await clientBundle(example))
  const mounted = await worker.mount(entry, { ...options, node })
  return { mounted, worker, text: () => mounted.roots().map(textOf).join(' ') }
}

const byText = (text: string) => (candidate: TreeNode) =>
  flatten(candidate).some((node) => node.type === '#text' && node.props.value === text)

describe('the tutorial', () => {
  it('says hello and names the branch from the Node half', async () => {
    const { mounted, worker, text } = await mount('hello-pane', 'pane')
    try {
      expect(text()).toContain('Ask the Node for a greeting')
      await mounted.fire((node) => node.type === 'Button' && byText('Say hello')(node))
      expect(text()).toContain('Hello from the node')
      await mounted.fire((node) => node.type === 'Button' && byText('Which branch?')(node))
      expect(text()).toContain('This task runs in the project folder')
    } finally {
      worker.close()
    }
  })
})

describe('acme-review', () => {
  it('builds, type-checks, and runs from the packed SDK outside the repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-review-'))
    try {
      cpSync(join(EXAMPLES, 'acme-review'), dir, { recursive: true })
      // The two packages under test are tarball bytes. The build tools and @types/node stand in for
      // what `npm install` fetches.
      const modules = join(dir, 'node_modules')
      unpackPublishedPackage('plugin-sdk', join(modules, 'acorn-plugin-sdk'))
      unpackPublishedPackage('plugin-types', join(modules, 'acorn-plugin-types'))
      copyNodeTypes(modules)
      for (const tool of ['vite', 'solid-js', 'vite-plugin-solid']) linkTool(tool, modules)
      run(process.execPath, [join(modules, 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'], dir)
      run(process.execPath, [TSC, '--noEmit'], dir)

      // One file with nothing left to import, that offers every entry the manifest names.
      const bundle = readFileSync(join(dir, 'dist', 'client.js'), 'utf8')
      expect(bundle).not.toMatch(/^\s*(import|export)\b/m)
      const worker = await startWorker(bundle)
      worker.close()
      expect([...worker.entries].sort()).toEqual(namedEntries(readExample('acme-review')))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('answers the routes each point calls', async () => {
    node = await startNode(readExample('acme-review'))
    const json = async (path: string, body?: unknown) =>
      (await node!.call(path, body === undefined ? {} : { method: 'POST', body })).json()
    const file = { kind: 'file', taskId: 't1', projectId: 'p1', path: 'src/a.ts', directory: false, readOnly: false }
    expect(await json('/v1/p/acme-review/add', { resource: file })).toEqual({ ok: true })
    expect(await json('/v1/p/acme-review/files?taskId=t1')).toEqual({ files: ['src/a.ts'] })
    expect(await json('/v1/p/acme-review/tools/files', { arguments: {}, origin: { taskId: 't1' } })).toEqual({
      files: ['src/a.ts'],
    })
    const keys = [
      { taskId: 't1', path: 'src/a.ts' },
      { taskId: 't1', path: 'b.ts' },
    ]
    expect((await json('/v1/p/acme-review/marks', { keys })).items).toEqual([
      { key: keys[0], severity: 'warn', text: 'Under review', icon: 'eye' },
    ])
    // Without Agents, the capability the artifact route reads isn't there, and the route says so.
    expect((await node.call('/v1/p/acme-review/artifact?taskId=t1&sessionId=s1&id=a1')).status).toBe(404)
    const docs = (url: string) => `/v1/p/acme-review/docs?url=${encodeURIComponent(url)}`
    expect((await json(docs('https://docs.example.com/guide/review'))).title).toBe('Review guide')
    expect((await node.call(docs('https://elsewhere.example.com/guide/review'))).status).toBe(404)
    expect(await json('/v1/p/acme-review/issue?item=ENG-1')).toEqual({ status: 'Approved by Acme review' })
    const text = '# Notes\n- TODO: check\n'
    const todo = { start: { line: 2, column: 3 }, end: { line: 2, column: 7 } }
    expect(await json('/v1/p/acme-review/diagnostics', { text, revision: 4 })).toEqual({
      revision: 4,
      items: [{ range: todo, severity: 'warning', message: 'Unresolved TODO', source: 'acme' }],
    })
    expect(
      await json('/v1/p/acme-review/hover', { text, position: { line: 2, column: 5 }, revision: 4 }),
    ).toMatchObject({
      revision: 4,
      range: todo,
      contents: { kind: 'markdown' },
    })
    expect(
      await json('/v1/p/acme-review/hover', { text: '# Notes\n', position: { line: 1, column: 1 }, revision: 4 }),
    ).toBe(null)
  })

  it('draws a review fence as a checklist and a CSV file as a table', async () => {
    const fence = await mount('acme-review', 'checklist', { props: PROPS['acme-review']!.checklist })
    const csv = await mount('acme-review', 'csvFile', { props: PROPS['acme-review']!.csvFile })
    try {
      expect(fence.text()).toBe('Review checklist src/a.ts src/b.ts')
      expect(csv.mounted.roots()[0]!.type).toBe('Table')
      expect(csv.text()).toContain('eu 20')
    } finally {
      fence.worker.close()
      csv.worker.close()
    }
  })
})

describe('acme-tracker', () => {
  it('selects a row in the rail list and draws it in the detail', async () => {
    const example = readExample('acme-tracker')
    node = await startNode(example)
    const worker = await startWorker(await clientBundle(example))
    try {
      const list = await worker.mount('list', { props: { sourceId: 'issues', region: 'list', collapsed: false }, node })
      const detail = await worker.mount('detail', { props: { sourceId: 'issues', region: 'detail' }, node })
      const text = (mounted: { roots(): TreeNode[] }) => mounted.roots().map(textOf).join(' ')
      expect(text(detail)).toContain('Webhooks give up after one retry')
      // A row with a `collapsedIcon` draws as the icon alone, so a full-width list sends none.
      expect(
        list
          .roots()
          .flatMap(flatten)
          .some((candidate) => candidate.props.collapsedIcon),
      ).toBe(false)
      await list.fire((candidate) => candidate.type === 'Row' && byText('VAT missing on EU invoices')(candidate))
      expect(text(detail)).toContain('Invoices to EU customers show no VAT line')
      // At icon width, each row still carries its icon and its name for the tooltip.
      const collapsed = await worker.mount('list', { props: { collapsed: true }, node })
      const rows = collapsed
        .roots()
        .flatMap(flatten)
        .filter((candidate) => candidate.type === 'Row')
      expect(rows.every((row) => row.props.collapsedIcon && row.props.label)).toBe(true)
    } finally {
      worker.close()
    }
  })

  it('answers the palette, the badges, the marks, and the inbox', async () => {
    node = await startNode(readExample('acme-tracker'))
    const json = async (path: string, init?: { method: string; body: unknown }) => (await node!.call(path, init)).json()
    const post = (body: unknown) => ({ method: 'POST', body })
    expect((await json('/v1/p/acme-tracker/issues/search?q=vat')).items).toEqual([
      { id: 'ACME-14', title: 'VAT missing on EU invoices', subtitle: 'ACME-14', badge: 'In review' },
    ])
    expect(await json('/v1/p/acme-tracker/sort')).toEqual({ value: 'state' })
    expect(await json('/v1/p/acme-tracker/sort', { method: 'PUT', body: { value: 'key' } })).toEqual({ value: 'key' })
    expect((await node.call('/v1/p/acme-tracker/sort', { method: 'PUT', body: { value: 'size' } })).status).toBe(400)
    expect(await json('/v1/p/acme-tracker/badge/open')).toMatchObject({ text: '2 open', tone: 'accent' })
    expect(await json('/v1/p/acme-tracker/marks/tasks', post({ keys: [{ task: 't1' }] }))).toEqual({ items: [] })
    expect(await json('/v1/p/acme-tracker/issues', post({ input: 'Slow login', taskId: 't1' }))).toMatchObject({
      ok: true,
    })
    expect(await json('/v1/p/acme-tracker/link', post({ item: 't1' }))).toMatchObject({ message: 'Linked ACME-12' })
    expect(
      (await json('/v1/p/acme-tracker/marks/tasks', post({ keys: [{ task: 't1' }, { task: 't2' }] }))).items,
    ).toEqual([{ key: { task: 't1' }, severity: 'info', text: '2 Acme issue(s)', icon: 'list-todo' }])
    expect(
      (await json('/v1/p/acme-tracker/marks/sources', post({ keys: [{ sourceId: 'issues', projectId: '' }] }))).items,
    ).toHaveLength(1)
    expect((await json('/v1/p/acme-tracker/attention')).items).toMatchObject([{ id: 'i14', severity: 'warn' }])
  })
})

describe('acme-points', () => {
  it('fills only points its owner declares, with the carrier each kind takes', () => {
    const owner = readExample('acme-points/acme-board').manifest
    const filler = readExample('acme-points/acme-links').manifest
    const points = new Map(
      (owner.contributions.extensionPoints ?? []).map((point) => [`${owner.id}:${point.id}`, point]),
    )
    for (const extension of filler.contributions.extensions ?? []) {
      const point = points.get(extension.point)
      expect(point, extension.point).toBeDefined()
      expect(point!.kind === 'rows' ? 'items' in extension : 'remote' in extension, extension.id).toBe(true)
    }
  })

  it('draws the deploy status for the card the board shows', async () => {
    const { worker, text } = await mount('acme-points/acme-links', 'summary', {
      props: PROPS['acme-points/acme-links']!.summary,
    })
    worker.close()
    expect(text()).toBe('Deployed to staging')
  })
})

describe('acme-switcher', () => {
  it('asks the host to show a pane rather than changing the layout itself', async () => {
    const { mounted, worker, text } = await mount('acme-switcher', 'switcher', {
      props: PROPS['acme-switcher']!.switcher,
    })
    try {
      expect(text()).toContain('Tracker')
      await mounted.fire((candidate) => candidate.type === 'Row' && byText('Tracker')(candidate))
      expect(mounted.hostRequests).toMatchObject([{ op: 'owner.invoke', name: 'show', payload: 'acme-tracker' }])
    } finally {
      worker.close()
    }
  })
})

describe('acme-frame', () => {
  it('draws its chart on a canvas from its own route, after the handshake', async () => {
    const example = readExample('acme-frame')
    node = await startNode(example)
    const drawn: string[] = []
    const element = () => ({
      width: 0,
      height: 0,
      dataset: {},
      setAttribute: (name: string, value: string) => drawn.push(`${name}=${value}`),
      getContext: () =>
        new Proxy(
          {},
          { get: (_target, name) => (name === 'lineTo' ? () => drawn.push('lineTo') : () => {}), set: () => true },
        ),
    })
    let hello: ((event: { data: unknown; ports: unknown[] }) => void) | undefined
    runInNewContext(readFileSync(join(example.dir, 'client.js'), 'utf8'), {
      document: { createElement: element, body: { append: () => {} }, documentElement: { dataset: {}, style: {} } },
      getComputedStyle: () => ({ getPropertyValue: () => '#f97316' }),
      addEventListener: (kind: string, listener: typeof hello) => {
        if (kind === 'message') hello = listener
      },
    })
    const bridge = new MessageChannel()
    const replies: unknown[] = []
    bridge.port1.on('message', async (message: { kind: string; id?: number; path?: string }) => {
      replies.push(message.kind)
      if (message.kind !== 'api') return
      const response = await node!.call(message.path!)
      bridge.port1.postMessage({ id: message.id, ok: true, status: 200, body: await response.json() })
    })
    try {
      hello!({ data: { acornBridge: 1 }, ports: [bridge.port2] })
      bridge.port1.postMessage({ kind: 'ready', context: { surface: 'acme-frame', target: 'pane' } })
      await vi.waitFor(() => expect(drawn.filter((step) => step === 'lineTo')).toHaveLength(6))
      expect(replies[0]).toBe('connected')
      expect(drawn).toContain('aria-label=Deploy minutes: 12, 9, 14, 8, 7, 11, 6')
    } finally {
      bridge.port1.close()
    }
  })
})
