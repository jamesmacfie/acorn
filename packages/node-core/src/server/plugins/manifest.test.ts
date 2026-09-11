import { describe, expect, it } from 'vitest'
import { THEME_PALETTE_TOKENS } from '@acorn/protocol/themeTokens.ts'
import { parsePluginManifest, pluginManifestSchema } from './manifest'

// The declarative-chrome half of the manifest (docs/plugins.md).
//
// What is worth pinning here is not the field list, since Zod holds that, but the three cross-field
// rules, because each one is a place a manifest could otherwise name something outside itself: a route
// in someone else's namespace, a pane it never declared, a non-https URL the shell would hand to the OS.

const manifest = (contributions: Record<string, unknown>) =>
  pluginManifestSchema.safeParse({ id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', contributions })

const permissionManifest = (permissions: Record<string, unknown>) =>
  pluginManifestSchema.safeParse({ id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', permissions })

const messages = (result: ReturnType<typeof manifest>) =>
  result.success ? [] : result.error.issues.map((issue) => issue.message)

/** Where each issue landed. The field, when two fields share one message. */
const paths = (result: ReturnType<typeof manifest>) =>
  result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))

// A pane says how it is drawn. `single` over a `frame` region is the plainest true answer and what
// almost every case here wants: the host draws the box, the plugin's own bundle draws the inside.
const PANE = { target: 'pane', id: 'board', label: 'Board', layout: 'single', regions: { body: 'frame' } }

// A webview needs a client bundle to steer it, so every webview case declares one. `manifest()` stays
// bundle-less because most surfaces do not need one.
// A schedule runs a node route, so every schedule case declares a node half, the same reason the webview
// cases declare a client one.
const nodeManifest = (contributions: Record<string, unknown>) =>
  pluginManifestSchema.safeParse({
    id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', node: './dist/node.js', contributions,
  })

const webviewManifest = (contributions: Record<string, unknown>) =>
  pluginManifestSchema.safeParse({
    id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', client: './dist/client.js', contributions,
  })

describe('brand marks', () => {
  const withIcons = (icons: Record<string, unknown>) =>
    pluginManifestSchema.safeParse({ id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', ...icons })

  it('accepts a path `d` and passes it through untouched', () => {
    const result = withIcons({ icon: { d: 'M12 .297c-6.63 0-12 5.373-12 12Z' } })
    expect(result.success && result.data.icon?.d).toBe('M12 .297c-6.63 0-12 5.373-12 12Z')
  })

  it('accepts a six-digit hex colour and refuses every other CSS colour', () => {
    expect(withIcons({ icon: { d: 'M0 0Z', color: '#5E6AD2' } }).success).toBe(true)
    // The string reaches a `style` attribute, and a colour slot accepts `url()`, which would make the
    // request. See docs/ui-design.md section Brand colour.
    expect(withIcons({ icon: { d: 'M0 0Z', color: 'url(https://evil.example/x)' } }).success).toBe(false)
    expect(withIcons({ icon: { d: 'M0 0Z', color: 'red' } }).success).toBe(false)
    expect(withIcons({ icon: { d: 'M0 0Z', color: '#5E6AD2; background: url(x)' } }).success).toBe(false)
    expect(withIcons({ icon: { d: 'M0 0Z', color: '#5E6' } }).success).toBe(false)
  })

  it('refuses anything the `d` grammar cannot express', () => {
    // The whole trust argument for shipping path data instead of an SVG document rests on this: if a mark
    // cannot carry a tag, a url() or an event handler, there is nothing in it to sanitise.
    expect(withIcons({ icon: { d: '<script>alert(1)</script>' } }).success).toBe(false)
    expect(withIcons({ icon: { d: 'M0 0 url(https://evil.example/x)' } }).success).toBe(false)
    expect(withIcons({ icon: { d: '' } }).success).toBe(false)
    expect(withIcons({ icon: { d: `M${'0'.repeat(4_096)}` } }).success).toBe(false)
  })

  it('bounds the plural feeder, whose every entry becomes a registry row', () => {
    expect(withIcons({ icons: { openai: { d: 'M0 0Z' }, anthropic: { d: 'M1 1Z' } } }).success).toBe(true)
    expect(withIcons({ icons: { 'Not A Key': { d: 'M0 0Z' } } }).success).toBe(false)
    // A key cannot reach out of the plugin's own namespace: the host stamps `brand:<pluginId>/` in front
    // of it, so a slash here would be a second segment, not an escape, but bound it anyway.
    expect(withIcons({ icons: { 'other/mark': { d: 'M0 0Z' } } }).success).toBe(false)
    expect(withIcons({ icons: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`m${i}`, { d: 'M0 0Z' }])) }).success).toBe(false)
  })
})

describe('permission identifier shape', () => {
  it('bounds scope and event strings before they can reach the trust layout', () => {
    expect(permissionManifest({ api: ['x'.repeat(65)] }).success).toBe(false)
    expect(permissionManifest({ events: ['not an event'] }).success).toBe(false)
    expect(permissionManifest({ events: [`runtime:${'x'.repeat(64)}`] }).success).toBe(false)
  })

  it('keeps unknown but well-formed requests forward compatible', () => {
    const result = permissionManifest({ api: ['core.quantum:read'], events: ['runtime:quantum-shift'] })
    expect(result.success).toBe(true)
  })

  it('accepts only individually named worker environment and file grants', () => {
    const result = permissionManifest({
      node: {
        env: ['DATABASE_URL'],
        files: [{ env: 'ACORN_NODES_FILE' }, { env: '_PRIVATE_CACHE', access: 'read-write' }],
      },
    })
    expect(result.success && result.data.permissions.node).toMatchObject({
      env: ['DATABASE_URL'],
      files: [{ env: 'ACORN_NODES_FILE', access: 'read' }, { env: '_PRIVATE_CACHE', access: 'read-write' }],
    })
    expect(permissionManifest({ node: { env: ['DATABASE_*'] } }).success).toBe(false)
    expect(permissionManifest({ node: { files: [{ env: 'nodes_file' }] } }).success).toBe(false)
  })
})

describe('overlay surfaces', () => {
  const overlay = { target: 'overlay', id: 'files', label: 'Go to file' }
  const opener = (action: unknown) => ({ id: 'open-files', title: 'Go to file', action })

  it('accepts an overlay opened by a command', () => {
    const result = manifest({ frames: [overlay], commands: [opener({ verb: 'openOverlay', overlay: 'files' })] })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.frames[0]?.target).toBe('overlay')
  })

  it('refuses an overlay nothing opens, and an openOverlay naming something else', () => {
    // The same rule a project-scoped pane is held to: a surface that parses and can never appear is worse
    // than a parse error, because it looks installed.
    expect(messages(manifest({ frames: [overlay] })))
      .toContain(`overlay 'files' needs an action that opens it; a command with a keybinding is the usual one`)
    expect(messages(manifest({ frames: [PANE], commands: [opener({ verb: 'openOverlay', overlay: 'board' })] })))
      .toContain(`openOverlay names 'board', which this manifest does not declare as an overlay surface`)
  })

  // The second opener, and the reason it had to be added to the same set: a plugin whose only opener is
  // a companion overlay would otherwise fail the check above, which reads as a plugin bug rather than
  // the missing platform rule it was.
  it('accepts an overlay opened by a remote contribution that associated it', () => {
    const result = webviewManifest({
      frames: [overlay],
      extensions: [{ id: 'preview', point: 'agents:attachment', label: 'Image markup', remote: 'attachmentPreview', overlay: 'files' }],
    })
    expect(result.success).toBe(true)
  })

  it('refuses a companion overlay this manifest does not declare', () => {
    expect(messages(webviewManifest({
      frames: [PANE],
      extensions: [{ id: 'preview', point: 'agents:attachment', label: 'Image markup', remote: 'attachmentPreview', overlay: 'files' }],
    }))).toContain(`extension names overlay 'files', which this manifest does not declare as an overlay surface`)
  })

  // A qualifier on the `remote` carrier, never a carrier of its own. A descriptor naming both would be
  // rejected by the exactly-one-carrier rule, which is the trap this pins shut.
  it('refuses a companion overlay on anything but a remote contribution', () => {
    expect(messages(manifest({
      frames: [overlay],
      extensions: [{ id: 'rows', point: 'agents:attachment', label: 'Rows', items: '/v2/p/board/rows', overlay: 'files' }],
    }))).toContain('overlay is only valid on a remote contribution')
  })

  it('keeps an overlay out of the pane sets', () => {
    // `openPane` puts a rectangle in a task's layout; an overlay has no layout to be put in.
    expect(messages(manifest({
      frames: [overlay],
      commands: [opener({ verb: 'openOverlay', overlay: 'files' }), { id: 'x', title: 'X', action: { verb: 'openPane', pane: 'files' } }],
    }))).toContain(`openPane names 'files', which this manifest does not declare as a task-scoped pane`)
    expect(messages(manifest({ frames: [{ ...overlay, scope: 'project' }], commands: [opener({ verb: 'openOverlay', overlay: 'files' })] })))
      .toContain('only a pane surface can be project-scoped')
  })
})

describe('webview surfaces', () => {
  it('accepts literal and plugin-route URL sources', () => {
    expect(webviewManifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', url: 'https://docs.example.com/start', hosts: ['docs.example.com'] }],
    }).success).toBe(true)
    expect(webviewManifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', urlSource: '/v2/p/board/webview-url', hosts: ['*.example.com'] }],
    }).success).toBe(true)
  })

  it('requires exactly one URL form and confines a source route to the plugin', () => {
    expect(manifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', hosts: ['docs.example.com'] }],
    }).success).toBe(false)
    expect(manifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', url: 'https://docs.example.com', urlSource: '/v2/p/board/url', hosts: ['docs.example.com'] }],
    }).success).toBe(false)
    expect(messages(manifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', urlSource: '/v2/p/other/url', hosts: ['docs.example.com'] }],
    }))).toContain('route must be inside /v2/p/board/')
  })

  it('validates hosts and requires a literal URL to stay inside them', () => {
    expect(webviewManifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', url: 'https://other.example.com', hosts: ['docs.example.com'] }],
    }).success).toBe(false)
    expect(webviewManifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', url: 'https://docs.example.com', hosts: ['*.*.example.com'] }],
    }).success).toBe(false)
    expect(webviewManifest({
      frames: [{ target: 'webview', id: 'local', label: 'Local', url: 'http://localhost:3000', hosts: ['localhost'] }],
    }).success).toBe(true)
    expect(webviewManifest({
      frames: [{ target: 'webview', id: 'remote', label: 'Remote', url: 'http://docs.example.com', hosts: ['docs.example.com'] }],
    }).success).toBe(false)
  })

  it('refuses a webview from a package with no client bundle', () => {
    // Two reasons, and the second is the one with teeth. The host mounts the bundle controller-only to
    // drive the view, so without one nothing steers it, and the trust queue holds bundles, so a
    // bundle-less package never reaches the prompt at all. Its declared hosts would be a disclosure nobody
    // was ever shown, for a surface that displays arbitrary web content.
    const declared = { target: 'webview', id: 'docs', label: 'Docs', url: 'https://docs.example.com', hosts: ['docs.example.com'] }
    expect(messages(manifest({ frames: [declared] }))).toContain('a webview surface needs a client bundle; declare `client` in the manifest')
    expect(webviewManifest({ frames: [declared] }).success).toBe(true)
  })
})

describe('pane layouts', () => {
  // A pane names one of the host's layouts and fills its regions (@acorn/protocol/paneLayouts.ts). The
  // host draws the editor and the plugin supplies the document, because a Monaco frame cannot be served
  // at all (docs/editor.md). What is worth pinning is the same class of rule as every other
  // cross-field check here: a plugin may not name a route outside its own namespace, a layout has the
  // regions it has, and a surface that parses and can never do anything is refused rather than shipped.
  const doc = (document: Record<string, unknown>) => ({ kind: 'document', ...document })
  const layout = (document: Record<string, unknown>) =>
    ({ ...PANE, layout: 'single', regions: { body: doc(document) } })
  // The document region by name, since that is the only kind these cases assert on: a `frame` region
  // is a bare string and a `remote` one carries an entry rather than a route.
  const region = (result: ReturnType<typeof manifest>, name: string) => {
    if (!result.success) return undefined
    const held = result.data.contributions.frames[0]?.regions?.[name]
    return typeof held === 'object' && held.kind === 'document' ? held : undefined
  }

  it('accepts a read/write document and defaults the language', () => {
    const result = manifest({ frames: [layout({ read: '/v2/p/board/doc', write: '/v2/p/board/doc' })] })
    expect(result.success).toBe(true)
    expect(region(result, 'body')?.languageId).toBe('plaintext')
  })

  it('treats a missing write route as read-only rather than as an error', () => {
    const result = manifest({ frames: [layout({ read: '/v2/p/board/doc', languageId: 'sql' })] })
    expect(result.success).toBe(true)
    expect(region(result, 'body')?.write).toBeUndefined()
  })

  it('confines both routes to the plugin, so the host cannot be made to read core on its behalf', () => {
    expect(messages(manifest({ frames: [layout({ read: '/v2/core/tasks' })] }))).toContain('route must be inside /v2/p/board/')
    expect(messages(manifest({ frames: [layout({ read: '/v2/p/board/doc', write: '/v2/p/other/doc' })] })))
      .toContain('route must be inside /v2/p/board/')
  })

  it('takes only a published language id', () => {
    expect(manifest({ frames: [layout({ read: '/v2/p/board/doc', languageId: 'brainfuck' })] }).success).toBe(false)
  })

  it('refuses a layout on a surface with no rectangle to arrange', () => {
    expect(messages(manifest({
      frames: [{ target: 'importer', id: 'board', label: 'Board', layout: 'single', regions: { body: doc({ read: '/v2/p/board/doc' }) } }],
    }))).toContain('layout is only valid on a pane, a reference panel or a settings page')
  })

  // A reference panel and a settings page have one region and host-drawn chrome around it, so `single`
  // is the only layout that means anything there — and naming it is how the surface says its body is a
  // tree rather than an iframe.
  it("lets a panel and a settings page name 'single', and nothing wider", () => {
    for (const target of ['refPanel', 'settings'] as const) {
      expect(manifest({
        frames: [{ target, id: 'board', label: 'Board', layout: 'single', regions: { body: { kind: 'remote', entry: 'pane' } } }],
      }).success).toBe(true)
      expect(messages(manifest({
        frames: [{ target, id: 'board', label: 'Board', layout: 'list-detail', regions: { list: 'frame', detail: 'frame' } }],
      })).join(' ')).toContain("only layout is 'single'")
    }
  })

  // A remote region names a key of the object the bundle passed to `mountTree`, not a route: there is
  // nothing to confine, and a name with no renderer behind it draws the labelled placeholder.
  it('accepts a remote region and asks it for no route', () => {
    const parsed = manifest({ frames: [{ ...PANE, layout: 'single', regions: { body: { kind: 'remote', entry: 'pane' } } }] })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.contributions.frames[0].regions?.body).toEqual({ kind: 'remote', entry: 'pane' })
  })

  it('refuses a layout name this build does not draw, and a region the layout does not have', () => {
    expect(manifest({ frames: [{ ...PANE, layout: 'carousel', regions: { body: doc({ read: '/v2/p/board/doc' }) } }] }).success).toBe(false)
    expect(messages(manifest({ frames: [{ ...PANE, layout: 'single', regions: { body: 'frame', sidebar: 'frame' } }] })))
      .toContain("layout 'single' has no sidebar region")
    expect(messages(manifest({ frames: [{ ...PANE, layout: 'list-detail', regions: { list: 'frame' } }] })))
      .toContain("layout 'list-detail' needs a detail region")
    const { layout: _dropped, ...noLayout } = PANE
    expect(messages(manifest({ frames: [{ ...noLayout, regions: { body: 'frame' } }] })))
      .toContain('regions need a layout to name them')
  })

  it('refuses key claims on a pane with no frame region, which draws nothing to claim them', () => {
    expect(messages(manifest({ frames: [{ ...layout({ read: '/v2/p/board/doc' }), claimsKeys: ['meta+j'] }] })))
      .toContain('this pane draws no frame, so there is nothing here to claim keys')
  })

  // `document-over-frame`: a document above the plugin's own frame, host-owned splitter between them. The
  // layout that arrived with its consumer, the database pane, which is what shipping the region
  // addressing on day one was for.
  const composed = (document: Record<string, unknown>) =>
    ({ ...PANE, layout: 'document-over-frame', regions: { document: doc(document), frame: 'frame' } })

  it('accepts a composed pane, and allows the key claims a host-drawn one refuses', () => {
    const result = manifest({ frames: [{ ...composed({ read: '/v2/p/board/doc', languageId: 'sql' }), claimsKeys: ['meta+j'] }] })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.frames[0]?.layout).toBe('document-over-frame')
  })

  it('confines the completions route like any other, and defaults its trigger characters', () => {
    const ok = manifest({ frames: [layout({ read: '/v2/p/board/doc', completions: { route: '/v2/p/board/complete' } })] })
    expect(ok.success).toBe(true)
    expect(region(ok, 'body')?.completions?.triggerCharacters).toEqual([])
    expect(messages(manifest({ frames: [layout({ read: '/v2/p/board/doc', completions: { route: '/v2/p/other/complete' } })] })))
      .toContain('route must be inside /v2/p/board/')
  })
})

describe('surface actions', () => {
  // A command delivered into a region the plugin draws: from the palette, or from a chord pressed in
  // the host's editor beside it, where that frame has no keyboard of its own. The rule worth pinning is
  // the one every other verb has: it may only name a surface this same manifest declares, and only one
  // that can receive it.
  const composedPane = {
    target: 'pane',
    id: 'query',
    label: 'Query',
    layout: 'document-over-frame',
    regions: {
      document: { kind: 'document', read: '/v2/p/board/doc', write: '/v2/p/board/doc' },
      frame: 'frame',
    },
  }
  const execute = (surface: string) => ({ id: 'execute', title: 'Run', action: { verb: 'surfaceAction', surface } })

  it('accepts a command aimed at a composed pane this manifest declares', () => {
    expect(manifest({ frames: [composedPane], commands: [execute('query')] }).success).toBe(true)
  })

  // A document beside the region is NOT required, although the verb was born in a pane that has one.
  // The palette is the other way in, and from there "do this in the thing I am looking at" is a sentence
  // about any pane the plugin draws — http's `list-detail` request panel as much as database's
  // editor-over-panel (docs/http-client.md § From the command palette).
  it('accepts a plain frame pane and a pane whose regions are trees, neither of which has a document', () => {
    expect(manifest({ frames: [PANE], commands: [execute('board')] }).success).toBe(true)
    const trees = {
      ...PANE,
      layout: 'list-detail',
      regions: { list: { kind: 'remote', entry: 'list' }, detail: { kind: 'remote', entry: 'detail' } },
    }
    expect(manifest({ frames: [trees], commands: [execute('board')] }).success).toBe(true)
  })

  it('refuses a pane with nothing of the plugin\'s own to receive it', () => {
    // Every region host-drawn: the pane runs none of this plugin's code, so a command aimed at it would
    // parse and then post into nothing.
    const wholePane = { ...PANE, layout: 'single', regions: { body: { kind: 'document', read: '/v2/p/board/doc' } } }
    expect(messages(manifest({ frames: [wholePane], commands: [execute('board')] })))
      .toContain("surfaceAction names 'board', which this manifest does not declare as a pane drawing a region of its own")
  })

  it('refuses another plugin\'s surface, which is to say any it did not declare', () => {
    expect(messages(manifest({ frames: [composedPane], commands: [execute('someone-elses')] })))
      .toContain("surfaceAction names 'someone-elses', which this manifest does not declare as a pane drawing a region of its own")
  })
})

describe('migration entrypoint confinement', () => {
  it('accepts a relative migrations directory and rejects escapes', () => {
    expect(pluginManifestSchema.safeParse({
      id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', migrations: './migrations',
    }).success).toBe(true)
    expect(pluginManifestSchema.safeParse({
      id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', migrations: '../other/migrations',
    }).success).toBe(false)
  })
})

describe('chrome descriptors', () => {
  it('accepts a chrome-only manifest with no frames at all', () => {
    const result = manifest({
      sources: [{ id: 'board', label: 'Board', glyph: 'kanban', order: 60, items: '/v2/p/board/rail-items' }],
      slots: [{ id: 'board-footer', slot: 'footer', data: '/v2/p/board/badge' }],
      palette: [{ id: 'board.new', title: 'Board: new card', action: { verb: 'runNodeAction', path: '/v2/p/board/new' } }],
      attention: [{ id: 'board-stuck', items: '/v2/p/board/attention' }],
      nodeStats: [{ id: 'board-count', label: ['card stuck', 'cards stuck'], data: '/v2/p/board/stat' }],
    })
    expect(result.success).toBe(true)
    // Defaults land, so the client never has to reason about an absent order.
    expect(result.success && result.data.contributions.attention[0]?.order).toBe(500)
    expect(result.success && result.data.contributions.frames).toEqual([])
  })

  it('defaults every chrome key to an empty array, so a phase-3 manifest still parses', () => {
    const result = manifest({ frames: [PANE] })
    expect(result.success && result.data.contributions.sources).toEqual([])
    expect(result.success && result.data.contributions.nodeStats).toEqual([])
    expect(result.success && result.data.contributions.contentLinks).toEqual([])
    expect(result.success && result.data.contributions.agentContexts).toEqual([])
    expect(result.success && result.data.contributions.refResolvers).toEqual([])
    expect(result.success && result.data.contributions.commands).toEqual([])
    expect(result.success && result.data.contributions.keybindings).toEqual([])
    expect(result.success && result.data.contributions.routes).toEqual([])
    // And a pane written before `scope` existed is still a task pane, which is the compatibility promise
    // the whole field rests on: rollbar's manifest has to keep behaving identically.
    expect(result.success && result.data.contributions.frames[0]?.scope).toBe('task')
  })

  it('confines every route to the plugin’s own namespace', () => {
    expect(messages(manifest({ sources: [{ id: 's', label: 'S', order: 1, items: '/v2/core/tasks' }] })))
      .toEqual(['route must be inside /v2/p/board/'])
    // Another plugin's namespace is the interesting case: it looks legal and is the whole point of the
    // check.
    expect(messages(manifest({ attention: [{ id: 'a', items: '/v2/p/github/attention' }] })))
      .toEqual(['route must be inside /v2/p/board/'])
    // A prefix match is not a namespace match.
    expect(messages(manifest({ nodeStats: [{ id: 'n', label: ['x', 'y'], data: '/v2/p/board-other/stat' }] })))
      .toEqual(['route must be inside /v2/p/board/'])
    expect(messages(manifest({ attention: [{ id: 'a', items: '/v2/p/board/../other/items' }] })))
      .toEqual(['route must be inside /v2/p/board/'])
    // `runNodeAction` carries a route too, and it is checked wherever an action can appear.
    expect(messages(manifest({ palette: [{ id: 'p', title: 'P', action: { verb: 'runNodeAction', path: '/v2/p/other/go' } }] })))
      .toEqual(['route must be inside /v2/p/board/'])
  })

  it('rejects an openPane naming a pane the manifest does not declare', () => {
    const bad = manifest({ sources: [{ id: 's', label: 'S', order: 1, items: '/v2/p/board/items', onSelect: { verb: 'openPane', pane: 'diff' } }] })
    expect(messages(bad)).toEqual([`openPane names 'diff', which this manifest does not declare as a task-scoped pane`])

    const good = manifest({
      frames: [PANE],
      sources: [{ id: 's', label: 'S', order: 1, items: '/v2/p/board/items', onSelect: { verb: 'openPane', pane: 'board' } }],
    })
    expect(good.success).toBe(true)
  })

  it('rejects a settings surface being used as an openPane target', () => {
    const bad = manifest({
      frames: [{ target: 'settings', id: 'board-settings', label: 'Board', layout: 'single', regions: { body: 'frame' } }],
      palette: [{ id: 'p', title: 'P', action: { verb: 'openPane', pane: 'board-settings' } }],
    })
    expect(bad.success).toBe(false)
  })

  it('rejects a non-https openUrl', () => {
    expect(manifest({ palette: [{ id: 'p', title: 'P', action: { verb: 'openUrl', url: 'https://example.com/x' } }] }).success).toBe(true)
    expect(manifest({ palette: [{ id: 'p', title: 'P', action: { verb: 'openUrl', url: 'http://example.com/x' } }] }).success).toBe(false)
  })

  it('rejects an unknown slot and an unknown verb', () => {
    expect(manifest({ slots: [{ id: 'x', slot: 'statusbar', data: '/v2/p/board/badge' }] }).success).toBe(false)
    // `invoke` is a v1 non-verb, since it needs a frame lifecycle the shell does not have. Failing here is
    // the point: an author is told, rather than shipping a palette row that silently does nothing.
    expect(manifest({ palette: [{ id: 'p', title: 'P', action: { verb: 'invoke', id: 'new-card' } }] }).success).toBe(false)
  })

  it('accepts the host-owned createTask verb without embedding executable steps', () => {
    const result = manifest({
      sources: [{
        id: 'board',
        label: 'Board',
        order: 60,
        items: '/v2/p/board/rail-items',
        onSelect: { verb: 'createTask' },
      }],
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.sources[0]?.onSelect).toEqual({ verb: 'createTask' })
  })

  it('rejects a duplicate contribution id across descriptor kinds', () => {
    const bad = manifest({ frames: [PANE], slots: [{ id: 'board', slot: 'footer', data: '/v2/p/board/badge' }] })
    expect(messages(bad)).toEqual([`duplicate contribution id 'board'`])
  })

  it('carries an agent-context pair and confines both of its routes', () => {
    const good = manifest({
      agentContexts: [{
        id: 'saved-requests',
        label: 'Saved HTTP requests',
        description: 'Request shapes with credential-bearing fields redacted.',
        options: '/v2/p/board/context-options',
        capture: '/v2/p/board/context-capture',
      }],
    })
    expect(good.success).toBe(true)
    expect(good.success && good.data.contributions.agentContexts[0]?.capture).toBe('/v2/p/board/context-capture')

    // A core route is the obvious escape; another plugin's namespace is the one that looks legal.
    expect(messages(manifest({
      agentContexts: [{ id: 'c', label: 'C', options: '/v2/core/tasks', capture: '/v2/p/board/capture' }],
    }))).toEqual(['route must be inside /v2/p/board/'])
    expect(messages(manifest({
      agentContexts: [{ id: 'c', label: 'C', options: '/v2/p/board/options', capture: '/v2/p/http/context-capture' }],
    }))).toEqual(['route must be inside /v2/p/board/'])
  })

  it('rejects an agent-context id already taken by another contribution kind', () => {
    expect(messages(manifest({
      frames: [PANE],
      agentContexts: [{ id: 'board', label: 'Board context', options: '/v2/p/board/options', capture: '/v2/p/board/capture' }],
    }))).toEqual([`duplicate contribution id 'board'`])
  })

  it('carries a source’s reserved panel region, and refuses one that also navigates', () => {
    const source = (over: Record<string, unknown>) => manifest({
      frames: [PANE],
      sources: [{ id: 's', label: 'S', order: 1, items: '/v2/p/board/rail-items', ...over }],
    })

    const parsed = source({ panels: { fieldRole: 'status', views: ['list', 'board'], max: 6 } })
    expect(parsed.success && parsed.data.contributions.sources[0]!.panels)
      .toEqual({ fieldRole: 'status', views: ['list', 'board'], max: 6 })

    // A source panel has one rectangle beside its rail list, and the detail half of a master/detail browse
    // already claims it. Declaring both would parse and then draw one of them.
    expect(messages(manifest({
      frames: [PROJECT_PANE],
      routes: [PROJECT_ROUTE],
      sources: [{ ...PROJECT_SOURCE, panels: {} }],
    }))).toContain('a source cannot reserve a panel region and navigate to a project-scoped surface — both draw beside the rail list')

    // An `openPane` source is unaffected: it opens a pane in a task and leaves this rectangle alone.
    expect(source({ panels: {}, onSelect: { verb: 'openPane', pane: 'board' } }).success).toBe(true)
  })

  it('carries a source empty state, bounds its message and narrows its action', () => {
    const source = (emptyState: unknown) => manifest({
      frames: [PANE],
      sources: [{ id: 's', label: 'S', order: 1, items: '/v2/p/board/rail-items', emptyState }],
    })

    expect(source({ message: 'No linked projects yet.' }).success).toBe(true)
    expect(source({ message: 'Nothing to show.', action: { verb: 'openPane', pane: 'board' }, actionLabel: 'Open board' }).success).toBe(true)

    // The two verbs an empty rail cannot carry, and the reason is the rail being empty: `createTask`
    // promotes a selected row and `navigate` substitutes a routed project into a surface path, and a state
    // that renders in place of the list has neither.
    expect(source({ message: 'x', action: { verb: 'createTask' } }).success).toBe(false)
    expect(source({ message: 'x', action: { verb: 'navigate', surface: 'board' } }).success).toBe(false)
    // The same route confinement every action gets, and the same url policy.
    expect(messages(source({ message: 'x', action: { verb: 'runNodeAction', path: '/v2/p/other/go' } })))
      .toEqual(['route must be inside /v2/p/board/'])
    expect(source({ message: 'x', action: { verb: 'openUrl', url: 'http://example.com' } }).success).toBe(false)
    // An action naming a pane this manifest never declared, which would render a button opening nothing.
    expect(messages(source({ message: 'x', action: { verb: 'openPane', pane: 'ghost' } })))
      .toEqual([`openPane names 'ghost', which this manifest does not declare as a task-scoped pane`])

    // Bounded, because it renders in the rail: a source cannot put an essay where a list goes.
    expect(source({ message: '' }).success).toBe(false)
    expect(source({ message: 'x'.repeat(161) }).success).toBe(false)
  })

  it('carries a ref resolver and confines the route it spends provider credentials on', () => {
    const good = manifest({
      refResolvers: [{ id: 'board-refs', kind: 'board.card', resolve: '/v2/p/board/refs' }],
    })
    expect(good.success).toBe(true)
    expect(good.success && good.data.contributions.refResolvers[0]?.resolve).toBe('/v2/p/board/refs')

    // The escape that matters here is naming another plugin's resolver: the host POSTs identifiers to
    // whatever this says and stamps the answer with the declaring plugin's provider, so an unconfined
    // route is how a plugin would publish someone else's items under its own name.
    expect(messages(manifest({
      refResolvers: [{ id: 'r', kind: 'board.card', resolve: '/v2/p/linear/issues' }],
    }))).toEqual(['route must be inside /v2/p/board/'])
    expect(messages(manifest({
      refResolvers: [{ id: 'r', kind: 'board.card', resolve: '/v2/core/integrations' }],
    }))).toEqual(['route must be inside /v2/p/board/'])
  })

  it('caps ref resolvers at four and refuses an id another contribution kind already took', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, kind: 'board.card', resolve: '/v2/p/board/refs' }))
    expect(manifest({ refResolvers: five }).success).toBe(false)
    expect(manifest({ refResolvers: five.slice(0, 4) }).success).toBe(true)

    expect(messages(manifest({
      frames: [PANE],
      refResolvers: [{ id: 'board', kind: 'board.card', resolve: '/v2/p/board/refs' }],
    }))).toEqual([`duplicate contribution id 'board'`])
  })

  it('carries a collection, confines its route and takes an optional static schema', () => {
    const good = manifest({
      collections: [{
        id: 'cards-mine',
        name: 'My cards',
        items: '/v2/p/board/collections/cards-mine',
        refresh: 300,
        params: [{ id: 'lane', name: 'Lane', type: 'enum', values: ['doing', 'done'] }],
        schema: {
          fields: [
            { id: 'title', name: 'Title', type: 'text', role: 'title' },
            { id: 'state', name: 'State', type: 'enum', role: 'status', values: [{ id: 'doing', label: 'Doing', tone: 'accent' }] },
          ],
        },
      }],
    })
    expect(good.success).toBe(true)
    expect(good.success && good.data.contributions.collections[0]?.schema?.fields).toHaveLength(2)

    // A collection with no static schema is the query-shaped case: its columns cannot be known at manifest
    // time, so the response describes itself instead.
    expect(manifest({ collections: [{ id: 'q', name: 'Query', items: '/v2/p/board/collections/q' }] }).success).toBe(true)

    // The route is the whole reason confinement exists here: the host fetches it and stamps the answer
    // with this plugin's id, so an unconfined one is how a plugin would put another's rows on a board
    // under its own badge.
    expect(messages(manifest({
      collections: [{ id: 'c', name: 'C', items: '/v2/p/linear/collections/issues-mine' }],
    }))).toEqual(['route must be inside /v2/p/board/'])
    expect(messages(manifest({
      collections: [{ id: 'c', name: 'C', items: '/v2/core/tasks' }],
    }))).toEqual(['route must be inside /v2/p/board/'])
  })

  it('caps collections at eight and refuses an id another contribution kind already took', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: 'C', items: '/v2/p/board/collections/c' }))
    expect(manifest({ collections: nine }).success).toBe(false)
    expect(manifest({ collections: nine.slice(0, 8) }).success).toBe(true)

    expect(messages(manifest({
      frames: [PANE],
      collections: [{ id: 'board', name: 'Board cards', items: '/v2/p/board/collections/cards' }],
    }))).toEqual([`duplicate contribution id 'board'`])
  })

  it('carries a schedule, confines its run route and insists there is a node half to serve it', () => {
    const good = nodeManifest({
      schedules: [{ id: 'refresh', name: 'Refresh the mirror', run: '/v2/p/board/schedules/refresh', cadence: { every: 600 }, timeout: 120 }],
    })
    expect(good.success && good.data.contributions.schedules[0]?.cadence).toEqual({ every: 600 })

    // The whole grammar, reused rather than re-declared: a schedule says when in the same three forms
    // core's own do.
    expect(nodeManifest({ schedules: [{ id: 's', name: 'S', run: '/v2/p/board/s', cadence: { daily: '03:30' } }] }).success).toBe(true)
    expect(nodeManifest({ schedules: [{ id: 's', name: 'S', run: '/v2/p/board/s', cadence: { weekly: { day: 1, at: '09:00' } } }] }).success).toBe(true)
    expect(nodeManifest({ schedules: [{ id: 's', name: 'S', run: '/v2/p/board/s', cadence: { cron: '* * * * *' } }] }).success).toBe(false)

    // Confinement is what stops a schedule being a way to make the node POST to core's routes, or to
    // another plugin's, unattended and on a timer.
    expect(messages(nodeManifest({
      schedules: [{ id: 's', name: 'S', run: '/v2/p/linear/sync', cadence: { every: 600 } }],
    }))).toEqual(['route must be inside /v2/p/board/'])
    expect(messages(nodeManifest({
      schedules: [{ id: 's', name: 'S', run: '/v2/core/tasks', cadence: { every: 600 } }],
    }))).toEqual(['route must be inside /v2/p/board/'])

    // Only a node half serves that namespace, so a client-only package declaring one would fire forever
    // against a 404.
    expect(messages(manifest({
      schedules: [{ id: 's', name: 'S', run: '/v2/p/board/s', cadence: { every: 600 } }],
    }))).toEqual(['a schedule runs a node route; declare `node` in the manifest'])
  })

  it('caps schedules at four and refuses an id another contribution kind already took', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: 'S', run: '/v2/p/board/s', cadence: { every: 600 } }))
    expect(nodeManifest({ schedules: five }).success).toBe(false)
    expect(nodeManifest({ schedules: five.slice(0, 4) }).success).toBe(true)

    expect(messages(nodeManifest({
      frames: [PANE],
      schedules: [{ id: 'board', name: 'S', run: '/v2/p/board/s', cadence: { every: 600 } }],
    }))).toEqual([`duplicate contribution id 'board'`])
  })

  it('carries a task check, confines both its routes and insists there is a node half to serve them', () => {
    const good = nodeManifest({
      taskChecks: [{ id: 'containers', check: '/v2/p/board/archive/check', apply: '/v2/p/board/archive/apply', timeout: 3 }],
    })
    expect(good.success && good.data.contributions.taskChecks[0]?.apply).toBe('/v2/p/board/archive/apply')

    // `apply` is optional: a check that only warns is a real mode, not a degenerate one.
    expect(nodeManifest({ taskChecks: [{ id: 'c', check: '/v2/p/board/c' }] }).success).toBe(true)

    // Both halves are confined, and neither may be another plugin's or core's: a check is a route the host
    // calls, so an unconfined one would be a way to make the node read anything on archive.
    expect(messages(nodeManifest({
      taskChecks: [{ id: 'c', check: '/v2/p/linear/c' }],
    }))).toEqual(['route must be inside /v2/p/board/'])
    expect(messages(nodeManifest({
      taskChecks: [{ id: 'c', check: '/v2/p/board/c', apply: '/v2/core/tasks' }],
    }))).toEqual(['route must be inside /v2/p/board/'])

    // Same rule a schedule gets, for the same reason: only a node half serves that namespace.
    expect(messages(manifest({
      taskChecks: [{ id: 'c', check: '/v2/p/board/c' }],
    }))).toEqual(['a task check calls a node route; declare `node` in the manifest'])
  })

  it('caps task checks at four and refuses an id another contribution kind already took', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, check: '/v2/p/board/c' }))
    expect(nodeManifest({ taskChecks: five }).success).toBe(false)
    expect(nodeManifest({ taskChecks: five.slice(0, 4) }).success).toBe(true)

    expect(messages(nodeManifest({
      frames: [PANE],
      taskChecks: [{ id: 'board', check: '/v2/p/board/c' }],
    }))).toEqual([`duplicate contribution id 'board'`])
  })

  it('accepts a data-only harness and insists a spawn names exactly one thing to run', () => {
    // The whole opencode plugin from docs/plugin-authoring.md § Harnesses, minus the icon: no node half,
    // no client half, no build step. If this stops parsing, that document is wrong.
    const opencode = manifest({
      harnesses: [{
        id: 'opencode',
        label: 'OpenCode',
        spawn: { command: 'opencode', args: ['acp'] },
        envPassthrough: ['OPENCODE_*'],
        quirks: { manualCompaction: true },
        terminal: { command: 'opencode' },
      }],
    })
    expect(opencode.success).toBe(true)
    expect(opencode.success && opencode.data.contributions.harnesses[0]).toMatchObject({
      spawn: { command: 'opencode', args: ['acp'] },
      quirks: { manualCompaction: true, sessionPersistence: false },
      terminal: { command: 'opencode', backendPreference: 'tmux', launchArgs: [] },
    })

    // Neither, or both, describes nothing acorn can start.
    expect(messages(manifest({ harnesses: [{ id: 'h', label: 'H', spawn: { args: ['acp'] } }] })))
      .toEqual(['a harness must declare exactly one of command or entry'])
    expect(messages(manifest({
      harnesses: [{ id: 'h', label: 'H', spawn: { command: 'h', entry: './dist/adapter.js' } }],
    }))).toEqual(['a harness must declare exactly one of command or entry'])
  })

  it('confines an adapter entry to the package and ties `requires` to it', () => {
    expect(manifest({
      harnesses: [{ id: 'h', label: 'H', spawn: { entry: './dist/adapter.js', requires: { command: 'h', env: 'H_BIN' } } }],
    }).success).toBe(true)

    // The same confinement every code entrypoint gets: a harness entry is a path acorn will run.
    expect(manifest({ harnesses: [{ id: 'h', label: 'H', spawn: { entry: '../../../etc/passwd' } }] }).success).toBe(false)
    expect(manifest({ harnesses: [{ id: 'h', label: 'H', spawn: { entry: '/usr/bin/node' } }] }).success).toBe(false)

    // `requires` says which CLI an adapter drives, so it means nothing beside a bare command.
    expect(messages(manifest({
      harnesses: [{ id: 'h', label: 'H', spawn: { command: 'h', requires: { command: 'x', env: 'X_BIN' } } }],
    }))).toEqual(['requires names the CLI an adapter drives, so it is only valid with entry'])
  })

  it('refuses an env passthrough that would copy the whole node environment', () => {
    expect(manifest({
      harnesses: [{ id: 'h', label: 'H', spawn: { command: 'h' }, envPassthrough: ['H_TOKEN_DIR', 'H_*'] }],
    }).success).toBe(true)
    // A bare `*` is the one glob that defeats the allowlist outright, refused here as well as in brokerEnv.
    expect(manifest({ harnesses: [{ id: 'h', label: 'H', spawn: { command: 'h' }, envPassthrough: ['*'] }] }).success).toBe(false)
    expect(manifest({ harnesses: [{ id: 'h', label: 'H', spawn: { command: 'h' }, envPassthrough: ['H-DASH'] }] }).success).toBe(false)
  })

  it('confines harness probe routes and insists there is a node half to serve them', () => {
    expect(nodeManifest({
      harnesses: [{ id: 'h', label: 'H', spawn: { command: 'h' }, probes: { usage: '/v2/p/board/h/usage', auth: '/v2/p/board/h/auth' } }],
    }).success).toBe(true)

    expect(messages(nodeManifest({
      harnesses: [{ id: 'h', label: 'H', spawn: { command: 'h' }, probes: { usage: '/v2/p/linear/usage' } }],
    }))).toEqual(['route must be inside /v2/p/board/'])

    // Verbatim the schedule and task-check rule: only a node half serves that namespace.
    expect(messages(manifest({
      harnesses: [{ id: 'h', label: 'H', spawn: { command: 'h' }, probes: { usage: '/v2/p/board/h/usage' } }],
    }))).toEqual(['a harness probe calls a node route; declare `node` in the manifest'])

    // And a harness with no probes needs no node half at all, which is the whole point of the tier.
    expect(manifest({ harnesses: [{ id: 'h', label: 'H', spawn: { command: 'h' } }] }).success).toBe(true)
  })

  it('caps harnesses at four and refuses an id another contribution kind already took', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `h${i}`, label: 'H', spawn: { command: 'h' } }))
    expect(manifest({ harnesses: five }).success).toBe(false)
    expect(manifest({ harnesses: five.slice(0, 4) }).success).toBe(true)

    expect(messages(manifest({
      frames: [PANE],
      harnesses: [{ id: 'board', label: 'H', spawn: { command: 'h' } }],
    }))).toEqual([`duplicate contribution id 'board'`])
  })

  it('floors the polling fallback so a descriptor cannot busy-loop a remote node', () => {
    expect(manifest({ slots: [{ id: 'x', slot: 'footer', data: '/v2/p/board/badge', refresh: 30 }] }).success).toBe(true)
    expect(manifest({ slots: [{ id: 'x', slot: 'footer', data: '/v2/p/board/badge', refresh: 5 }] }).success).toBe(false)
  })

  it('validates declarative content links against their declared pane and capture', () => {
    const good = manifest({
      frames: [PANE],
      contentLinks: [{
        id: 'board.card',
        match: 'https://*.board.example/cards/{key}',
        openPane: 'board',
        item: 'key',
      }],
    })
    expect(good.success).toBe(true)

    expect(messages(manifest({
      contentLinks: [{
        id: 'board.card', match: 'https://board.example/cards/{key}', openPane: 'missing', item: 'key',
      }],
    }))).toContain(`content link names 'missing', which this manifest does not declare as a task-scoped pane`)

    expect(messages(manifest({
      frames: [PANE],
      contentLinks: [{
        id: 'board.card', match: 'https://board.example/cards/{key}', openPane: 'board', item: 'id',
      }],
    }))).toContain(`content link item 'id' is not captured by its match pattern`)
  })

  it('accepts a content link whose only destination is this plugin reference panel', () => {
    // `openPane` is optional because a plugin can have items worth glancing at and no task pane at all.
    // The panel is addressed by provider, and a refPanel's provider is already the plugin id, so declaring
    // one is the whole declaration.
    expect(manifest({
      frames: [{ target: 'refPanel', id: 'board-ref', label: 'Card', providerId: 'board', layout: 'single', regions: { body: 'frame' } }],
      contentLinks: [{ id: 'board.card', match: 'https://board.example/cards/{key}', item: 'key' }],
    }).success).toBe(true)
  })

  it('rejects a content link with no destination at all', () => {
    // The rule the project-scoped pane checks already state, in the other direction: a contribution that
    // parses and can never do anything is worse than a parse error, because it looks installed.
    expect(messages(manifest({
      frames: [PANE],
      contentLinks: [{ id: 'board.card', match: 'https://board.example/cards/{key}', item: 'key' }],
    }))).toContain(`content link 'board.card' has nowhere to open: declare openPane, or a refPanel surface for this plugin's items`)
  })
})

// A project-scoped pane plus the route that addresses it and the source that mounts it. Written out once
// because every case below is a mutation of exactly one of the three.
const PROJECT_PANE = { target: 'pane', id: 'board-card', label: 'Card', scope: 'project', layout: 'single', regions: { body: 'frame' } }
const PROJECT_ROUTE = { id: 'board.card-route', path: '/p/:projectId/x/board/cards/:key', surface: 'board-card', item: 'key' }
const PROJECT_SOURCE = { id: 'board', label: 'Board', order: 60, items: '/v2/p/board/rail-items', onSelect: { verb: 'navigate', surface: 'board-card' } }

describe('project-scoped surfaces and their routes', () => {
  it('carries a project-scoped pane addressed by a host-prefixed route', () => {
    const result = manifest({ frames: [PROJECT_PANE], routes: [PROJECT_ROUTE], sources: [PROJECT_SOURCE] })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.frames[0]?.scope).toBe('project')
    // `order` defaults like every other registration order does, so the client never sorts on undefined.
    expect(result.success && result.data.contributions.routes[0]?.order).toBe(500)
  })

  it('confines a route to the prefix the host mints from the plugin id', () => {
    // Core's own project URL is the whole hazard: a manifest that could claim it would take over project
    // navigation for the entire shell.
    const core = manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, path: '/p/:projectId/cards/:key' }] })
    expect(messages(core)).toContain('route must be inside /p/:projectId/x/board/')
    // Another plugin's prefix looks legal, which is why it is checked rather than assumed.
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, path: '/p/:projectId/x/github/cards/:key' }] })))
      .toContain('route must be inside /p/:projectId/x/board/')
    // A prefix match is not a namespace match, and dot segments are normalised before the check so an
    // apparently owned path cannot escape afterwards.
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, path: '/p/:projectId/x/board-other/cards/:key' }] })))
      .toContain('route must be inside /p/:projectId/x/board/')
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, path: '/p/:projectId/x/board/../../settings' }] })))
      .toContain('route must be inside /p/:projectId/x/board/')
    // Not a path at all, and a path leaving the origin both report the same confinement failure.
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, path: 'cards/:key' }] })))
      .toContain('route must be inside /p/:projectId/x/board/')
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, path: '//evil.example/p/:projectId/x/board/cards/:key' }] })))
      .toContain('route must be inside /p/:projectId/x/board/')
  })

  it('rejects a route naming a surface this manifest does not declare as project-scoped', () => {
    expect(messages(manifest({ routes: [PROJECT_ROUTE] })))
      .toContain(`route names 'board-card', which this manifest does not declare as a project-scoped pane`)
    // A task pane is not addressable this way either: its selection lives in the task's layout, and the
    // surface it would mount into does not exist outside one.
    expect(messages(manifest({
      frames: [PANE],
      routes: [{ ...PROJECT_ROUTE, surface: 'board' }],
    }))).toContain(`route names 'board', which this manifest does not declare as a project-scoped pane`)
  })

  it('requires the addressed item to be a parameter of the path, and never projectId', () => {
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, item: 'identifier' }] })))
      .toContain(`route item 'identifier' must be a :param of its path other than projectId`)
    // `projectId` is a parameter of every such path, and it is the host's, bound before a plugin sees it.
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, item: 'projectId' }] })))
      .toContain(`route item 'projectId' must be a :param of its path other than projectId`)
  })

  it('refuses a project-scoped surface with no address and no mount site', () => {
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE] })))
      .toContain(`project-scoped pane 'board-card' needs a routes entry; it has no other address`)
    expect(messages(manifest({ frames: [PROJECT_PANE], routes: [PROJECT_ROUTE] })))
      .toContain(`project-scoped pane 'board-card' needs a source whose onSelect navigates to it; it has nowhere else to mount`)
  })

  it('keeps openPane and navigate on disjoint sets of surfaces', () => {
    // The refusal the whole change is about: `openPane` on a project-scoped surface would toast "open a
    // task first" forever, so the manifest says no instead of the runtime saying nothing useful.
    expect(messages(manifest({
      frames: [PROJECT_PANE],
      routes: [PROJECT_ROUTE],
      sources: [{ ...PROJECT_SOURCE, onSelect: { verb: 'openPane', pane: 'board-card' } }],
    }))).toContain(`openPane names 'board-card', which this manifest does not declare as a task-scoped pane`)
    // And the other way: navigating to a task pane has no URL to go to.
    expect(messages(manifest({
      frames: [PANE],
      sources: [{ ...PROJECT_SOURCE, onSelect: { verb: 'navigate', surface: 'board' } }],
    }))).toContain(`navigate names 'board', which this manifest does not declare as a project-scoped pane`)
  })

  it('refuses navigate from a command, which has no project and no navigator', () => {
    expect(manifest({
      frames: [PROJECT_PANE],
      routes: [PROJECT_ROUTE],
      sources: [PROJECT_SOURCE],
      commands: [{ id: 'board.open', title: 'Board: open card', action: { verb: 'navigate', surface: 'board-card' } }],
    }).success).toBe(false)
  })

  // The one click site inside a command that can carry `navigate`: a search result. It has a picked
  // row and, at project scope, the project the palette session captured, which is exactly the pair the
  // verb was missing everywhere else (docs/plugins.md § Command kinds).
  it('lets a search result navigate, and counts it as a mount site for the surface', () => {
    const find = {
      id: 'find', title: 'Board: find a card', kind: 'search', scope: 'project',
      route: '/v2/p/board/search', onSelect: { verb: 'navigate', surface: 'board-card' },
    }
    // `nodeManifest`, because a search calls a node route and only a node half serves one.
    expect(nodeManifest({
      frames: [PROJECT_PANE], routes: [PROJECT_ROUTE], sources: [PROJECT_SOURCE], commands: [find],
    }).success).toBe(true)
    // And on its own: a project-scoped surface reached only from the palette is addressed and
    // mountable, so the "nowhere to mount" refusal must not fire on it.
    expect(nodeManifest({
      frames: [PROJECT_PANE], routes: [PROJECT_ROUTE], commands: [find],
    }).success).toBe(true)
    // The surface still has to be one this manifest declared as project-scoped.
    expect(messages(nodeManifest({
      frames: [PROJECT_PANE], routes: [PROJECT_ROUTE], sources: [PROJECT_SOURCE],
      commands: [{ ...find, onSelect: { verb: 'navigate', surface: 'nope' } }],
    }))).toContain(`navigate names 'nope', which this manifest does not declare as a project-scoped pane`)
  })

  it('refuses navigate and createTask from a slot badge, whose click carries no row and no project', () => {
    const slot = (onClick: unknown) => manifest({
      frames: [PROJECT_PANE],
      routes: [PROJECT_ROUTE],
      sources: [PROJECT_SOURCE],
      slots: [{ id: 'board-footer', slot: 'footer', data: '/v2/p/board/badge', onClick }],
    }).success
    expect(slot({ verb: 'navigate', surface: 'board-card' })).toBe(false)
    expect(slot({ verb: 'createTask' })).toBe(false)
    expect(slot({ verb: 'runNodeAction', path: '/v2/p/board/refresh' })).toBe(true)
  })

  it('allows only a pane to be project-scoped, and folds routes into the duplicate-id sweep', () => {
    expect(messages(manifest({ frames: [{ target: 'settings', id: 'board-settings', label: 'Board', scope: 'project', layout: 'single', regions: { body: 'frame' } }] })))
      .toContain('only a pane surface can be project-scoped')
    expect(messages(manifest({
      frames: [PROJECT_PANE],
      sources: [PROJECT_SOURCE],
      routes: [{ ...PROJECT_ROUTE, id: 'board' }],
    }))).toContain(`duplicate contribution id 'board'`)
  })
})

describe('plugin commands and keybindings', () => {
  const command = {
    id: 'search',
    title: 'Editor: find in files',
    action: { verb: 'runNodeAction', path: '/v2/p/board/search' },
  }

  it('parses every command verb and supplies stable defaults', () => {
    const result = manifest({
      frames: [PANE],
      commands: [
        command,
        { id: 'open', title: 'Open board', action: { verb: 'openPane', pane: 'board' } },
        { id: 'docs', title: 'Open docs', palette: false, action: { verb: 'openUrl', url: 'https://example.com/docs' } },
      ],
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.commands[0]).toMatchObject({ category: 'action', palette: true })
    expect(result.success && result.data.contributions.commands[2]?.palette).toBe(false)
  })

  it('keeps palette descriptors as a compatibility alias and rejects command action escapes', () => {
    expect(manifest({ palette: [{ id: 'old', title: 'Old', action: { verb: 'runNodeAction', path: '/v2/p/board/old' } }] }).success).toBe(true)
    expect(manifest({ commands: [{ ...command, action: { verb: 'runNodeAction', path: '/v2/core/tasks' } }] }).success).toBe(false)
    expect(manifest({ commands: [{ ...command, action: { verb: 'createTask' } }] }).success).toBe(false)
  })

  // The five kinds a manifest may declare (@acorn/protocol/plugin/contract.ts). What is worth pinning
  // is that the addition is additive — the descriptor above, with no `kind` at all, is still the action
  // it always was — and that the new kinds are held to the same confinement every other route is.
  const group = { id: 'cards', title: 'Cards', category: 'navigation', kind: 'group' }
  const find = {
    id: 'find', title: 'Find a card', kind: 'search', route: '/v2/p/board/search',
    onSelect: { verb: 'runNodeAction', path: '/v2/p/board/open' },
  }
  const ask = {
    id: 'ask', title: 'New card', kind: 'input', route: '/v2/p/board/new-card',
    onSuccess: { verb: 'runNodeAction', path: '/v2/p/board/open' },
  }
  const theme = {
    id: 'theme', title: 'Board theme', kind: 'setting',
    readRoute: '/v2/p/board/theme', writeRoute: '/v2/p/board/theme',
    options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
  }

  it('reads a command with no kind as the action it has always meant', () => {
    const result = manifest({ commands: [command] })
    expect(result.success && result.data.contributions.commands[0]).toMatchObject({ kind: 'action', palette: true })
  })

  it('accepts a group, a search and an input, with the search bounds defaulted', () => {
    const result = nodeManifest({
      commands: [
        group,
        { ...find, parentId: 'cards', minQueryLength: 3, debounceMs: 400, placeholder: 'Card title…' },
        ask,
      ],
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.commands[1]).toMatchObject({
      kind: 'search', scope: 'node', minQueryLength: 3, debounceMs: 400,
    })
  })

  it('refuses a search that would spend a request on every keystroke, or ask for a novel', () => {
    expect(nodeManifest({ commands: [{ ...find, debounceMs: 5 }] }).success).toBe(false)
    expect(nodeManifest({ commands: [{ ...find, minQueryLength: 40 }] }).success).toBe(false)
    // `fleet` is not a scope a manifest may name: fanning a plugin's route out over every paired node
    // is not a decision a declaration gets to make for somebody's network.
    expect(nodeManifest({ commands: [{ ...find, scope: 'fleet' }] }).success).toBe(false)
  })

  it('confines both new routes and both new verbs to the plugin’s own namespace', () => {
    expect(messages(nodeManifest({ commands: [{ ...find, route: '/v2/p/other/search' }] })))
      .toContain('route must be inside /v2/p/board/')
    expect(messages(nodeManifest({ commands: [{ ...ask, route: '/v2/tasks' }] })))
      .toContain('route must be inside /v2/p/board/')
    expect(messages(nodeManifest({ commands: [{ ...find, onSelect: { verb: 'runNodeAction', path: '/v2/core/tasks' } }] })))
      .toContain('route must be inside /v2/p/board/')
  })

  it('refuses a search, an input or a setting from a package with no node half to answer it', () => {
    expect(messages(manifest({ commands: [find] })))
      .toContain('a search command calls a node route; declare `node` in the manifest')
    expect(messages(manifest({ commands: [ask] })))
      .toContain('an input command calls a node route; declare `node` in the manifest')
    expect(messages(manifest({ commands: [theme] })))
      .toContain('a setting command calls a node route; declare `node` in the manifest')
  })

  it('accepts a setting with two of its own routes and a bounded list of choices', () => {
    const result = nodeManifest({ commands: [group, { ...theme, parentId: 'cards', scope: 'project' }] })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.commands[1]).toMatchObject({
      kind: 'setting', scope: 'project', readRoute: '/v2/p/board/theme',
    })
  })

  it('confines both of a setting’s routes to the plugin’s own namespace', () => {
    // The message is the shared one; what the path in the issue names is which of the two routes.
    expect(messages(nodeManifest({ commands: [{ ...theme, readRoute: '/v2/prefs' }] })))
      .toContain('route must be inside /v2/p/board/')
    expect(paths(nodeManifest({ commands: [{ ...theme, readRoute: '/v2/prefs' }] })))
      .toContain('contributions.commands.0.readRoute')
    expect(paths(nodeManifest({ commands: [{ ...theme, writeRoute: '/v2/p/other/theme' }] })))
      .toContain('contributions.commands.0.writeRoute')
  })

  it('refuses a setting that is not a choice: too few options, too many, or two spelled the same', () => {
    expect(nodeManifest({ commands: [{ ...theme, options: [{ value: 'light', label: 'Light' }] }] }).success).toBe(false)
    expect(nodeManifest({
      commands: [{ ...theme, options: Array.from({ length: 33 }, (_, at) => ({ value: `v${at}`, label: `V${at}` })) }],
    }).success).toBe(false)
    expect(messages(nodeManifest({
      commands: [{ ...theme, options: [{ value: 'light', label: 'Light' }, { value: 'light', label: 'Also light' }] }],
    }))).toContain("setting 'theme' declares 'light' twice")
  })

  it('holds the parent graph together across the whole array', () => {
    expect(messages(nodeManifest({ commands: [{ ...find, parentId: 'gone' }] })))
      .toContain("command 'find' names an undeclared parent 'gone'")
    expect(messages(nodeManifest({ commands: [command, { ...find, parentId: 'search' }] })))
      .toContain("command 'find' names 'search', which is not a group")
    expect(messages(nodeManifest({
      commands: [{ ...group, parentId: 'other' }, { id: 'other', title: 'Other', kind: 'group', parentId: 'cards' }],
    }))).toContain("command 'cards' is inside a parent cycle")
  })

  it.each(['meta+shift+f', 'ctrl+alt+enter'])('accepts canonical modified chord %s', (defaultChord) => {
    expect(manifest({ commands: [command], keybindings: [{ command: 'search', defaultChord, when: 'task' }] }).success).toBe(true)
  })

  it.each(['Meta+Shift+F', 'shift+meta+f', 'f', 'shift+f', 'hyper+f', 'meta+f g'])('rejects unusable chord %s', (defaultChord) => {
    expect(manifest({ commands: [command], keybindings: [{ command: 'search', defaultChord, when: 'task' }] }).success).toBe(false)
  })

  it('requires commands and surface scopes to point inside the same manifest', () => {
    expect(messages(manifest({ commands: [command], keybindings: [{ command: 'missing', defaultChord: 'meta+f', when: 'task' }] })))
      .toContain("keybinding names undeclared command 'missing'")
    expect(manifest({ commands: [command], keybindings: [{ command: 'search', defaultChord: 'meta+f', when: 'surface' }] }).success).toBe(false)
    expect(manifest({ frames: [PANE], commands: [command], keybindings: [{ command: 'search', defaultChord: 'meta+f', when: 'surface', surface: 'board' }] }).success).toBe(true)
    expect(messages(manifest({
      commands: [command],
      keybindings: [
        { command: 'search', defaultChord: 'meta+f', when: 'global' },
        { command: 'search', defaultChord: 'meta+g', when: 'global' },
      ],
    }))).toContain("command 'search' has more than one keybinding")
  })

  it('allows declared frame claims except for shell escape hatches', () => {
    expect(manifest({ frames: [{ ...PANE, claimsKeys: ['meta+f', 'meta+shift+f'] }] }).success).toBe(true)
    for (const chord of ['meta+k', 'meta+,', 'meta+1', 'meta+9', 'escape']) {
      expect(messages(manifest({ frames: [{ ...PANE, claimsKeys: [chord] }] }))).toContain(`${chord} is reserved by acorn and cannot be claimed`)
    }
  })
})

describe('themes', () => {
  // The parse-time half of "a plugin theme cannot break the app" (docs/ui-design.md § Appearance). The
  // client re-checks all of it before generating CSS, because a roster row is bytes a node sent, but this
  // is where an author finds out, so each rule is pinned at the door it is enforced at.
  const palette = Object.fromEntries(THEME_PALETTE_TOKENS.map((name) => [name, '#123456']))
  const theme = (over: Record<string, unknown> = {}) => ({ id: 'nightfall', label: 'Nightfall', tokens: palette, ...over })

  it('accepts a complete palette and defaults the dark flag', () => {
    expect(manifest({ themes: [theme({ dark: true })] }).success).toBe(true)
    const parsed = manifest({ themes: [theme()] })
    expect(parsed.success && parsed.data.contributions.themes[0]!.dark).toBe(false)
  })

  it('requires every palette token, so a theme can never be half a palette', () => {
    const partial = { ...palette }
    delete partial['--hunk-text']
    expect(manifest({ themes: [theme({ tokens: partial })] }).success).toBe(false)
  })

  it('refuses unknown, derived, self-description and cross-axis token names', () => {
    // Derived tokens are `var()` references declared once on :root; the self-description three are written
    // by the host from `dark`; `--radius` belongs to the other axis entirely. All four kinds of overreach
    // are the same refusal, because the map is a strict object over one closed list.
    for (const name of ['--made-up', '--danger', '--surface-sunken', '--is-dark', '--syntax-fg', '--radius']) {
      expect(manifest({ themes: [theme({ tokens: { ...palette, [name]: '#fff' } })] }).success, name).toBe(false)
    }
  })

  it('refuses a value that is not a colour, including one that could escape the block', () => {
    for (const value of ['red', 'inherit', 'var(--bg)', 'url(https://evil.example/x)', '#fff; } :root { --bg: red', '#fff\n}']) {
      expect(manifest({ themes: [theme({ tokens: { ...palette, '--bg': value } })] }).success, value).toBe(false)
    }
  })

  it('accepts hex and flat colour functions', () => {
    for (const value of ['#fff', '#ffffff', '#ffffffcc', 'rgba(0, 0, 0, 0.42)', 'oklch(0.7 0.15 250)', 'hsl(210 100% 50%)']) {
      expect(manifest({ themes: [theme({ tokens: { ...palette, '--bg': value } })] }).success, value).toBe(true)
    }
  })

  it('bounds the id to what can go inside a CSS attribute selector', () => {
    for (const id of ['Nightfall', 'night fall', 'night"fall', '-night']) {
      expect(manifest({ themes: [theme({ id })] }).success, id).toBe(false)
    }
  })

  it('counts a theme id in the one-id-per-contribution rule', () => {
    expect(messages(manifest({ themes: [theme(), theme()] }))).toContain("duplicate contribution id 'nightfall'")
  })
})

describe('slots', () => {
  const slot = (over: Record<string, unknown> = {}) =>
    ({ id: 'board-badge', slot: 'footer', data: '/v2/p/board/badge', ...over })

  it('accepts the two host slots that have a host to draw them', () => {
    expect(manifest({ slots: [slot()] }).success).toBe(true)
    expect(manifest({ slots: [slot({ id: 'board-chip', slot: 'topbar' })] }).success).toBe(true)
  })

  it('refuses every client slot id that is not one of them', () => {
    // Each of these is a real member of the client's own slot union, and each is refused for its own reason
    // (@acorn/protocol/plugin/contract.ts, slotDescriptor). A parse error is the point: a manifest naming
    // one would otherwise install and never appear.
    for (const name of ['overlay', 'drawer', 'topbar.left', 'topbar.right', 'task.footer']) {
      expect(manifest({ slots: [slot({ slot: name })] }).success, name).toBe(false)
    }
  })

  it('confines a slot’s data route and its click verb to the plugin’s own namespace', () => {
    expect(messages(manifest({ slots: [slot({ data: '/v2/core/tasks' })] })))
      .toContain('route must be inside /v2/p/board/')
    expect(messages(manifest({ slots: [slot({ onClick: { verb: 'runNodeAction', path: '/v2/p/other/go' } })] })))
      .toContain('route must be inside /v2/p/board/')
  })
})

describe('context menus', () => {
  // The declarative right-click contribution. Two things are worth pinning at this door: the closed
  // location vocabulary, and that a `when` may only name facts the location actually supplies, because a
  // predicate that can never match is a contribution that installs and does nothing.
  const menu = (over: Record<string, unknown> = {}) => ({
    id: 'open-card',
    location: 'task.row',
    label: 'Open the board card',
    action: { verb: 'runNodeAction', path: '/v2/p/board/open' },
    ...over,
  })

  it('accepts a row on a declared location and defaults its order', () => {
    const parsed = manifest({ contextMenus: [menu()] })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.contributions.contextMenus[0]!.order).toBe(500)
  })

  it('refuses a location the host does not draw', () => {
    for (const location of ['file.row', 'task.footer', 'TASK.ROW', '']) {
      expect(manifest({ contextMenus: [menu({ location })] }).success, location).toBe(false)
    }
  })

  it('refuses a `when` naming a fact the location does not have', () => {
    expect(manifest({ contextMenus: [menu({ when: { origin: 'github', pinned: true, projectId: 'p1' } })] }).success).toBe(true)
    expect(messages(manifest({ contextMenus: [menu({ when: { branch: 'main' } })] })))
      .toContain("'task.row' has no fact named 'branch'")
    // The identity fields are on the target and still not facts: a menu row keyed to one task id is not an
    // extension point.
    expect(messages(manifest({ contextMenus: [menu({ when: { id: 't1' } })] })))
      .toContain("'task.row' has no fact named 'id'")
  })

  it('takes the context-free verb set only, and confines its route', () => {
    // The two verbs missing from this union need something a right-clicked core row cannot supply:
    // `createTask` the host's promotion callback over a rail item, `navigate` a project-scoped surface of
    // this plugin's own.
    expect(manifest({ contextMenus: [menu({ action: { verb: 'createTask' } })] }).success).toBe(false)
    expect(manifest({ contextMenus: [menu({ action: { verb: 'navigate', surface: 'board' } })] }).success).toBe(false)
    expect(manifest({ contextMenus: [menu({ action: { verb: 'teleport' } })] }).success).toBe(false)
    expect(messages(manifest({ contextMenus: [menu({ action: { verb: 'runNodeAction', path: '/v2/core/tasks' } })] })))
      .toContain('route must be inside /v2/p/board/')
    expect(messages(manifest({ contextMenus: [menu({ action: { verb: 'openPane', pane: 'ghost' } })] })))
      .toContain("openPane names 'ghost', which this manifest does not declare as a task-scoped pane")
  })

  it('caps the list and counts its ids in the one-id-per-contribution rule', () => {
    expect(manifest({ contextMenus: Array.from({ length: 8 }, (_, i) => menu({ id: `row-${i}` })) }).success).toBe(true)
    expect(manifest({ contextMenus: Array.from({ length: 9 }, (_, i) => menu({ id: `row-${i}` })) }).success).toBe(false)
    expect(messages(manifest({ contextMenus: [menu(), menu()] }))).toContain("duplicate contribution id 'open-card'")
  })
})

// ── Cooperative cross-plugin extension, and the exclusive slot ─────────────────────────────────────
//
// Two manifest keys and one frame target, and every rule below turns the same failure into a parse error:
// a declaration that installs, looks fine, and can never do anything. That failure is worse than a
// rejection here because it looks like it worked, and with two manifests involved it would be debugged
// from the wrong one, since the author of the guest sees nothing but an empty strip.

describe('extension points', () => {
  const point = (over: Record<string, unknown> = {}) =>
    ({ id: 'card-links', label: 'Linked items', location: 'pane.footer', surface: 'board', ...over })

  it('accepts a point hung off a pane this manifest declares', () => {
    expect(manifest({ frames: [PANE], extensionPoints: [point()] }).success).toBe(true)
  })

  it('refuses a point on a surface this manifest does not declare', () => {
    expect(messages(manifest({ frames: [PANE], extensionPoints: [point({ surface: 'ghost' })] })))
      .toContain("extension point names 'ghost', which this manifest does not declare as a pane surface")
    // A settings page, importer, overlay, refPanel or webview is chrome the host already draws around a
    // frame; there is nowhere in one to reserve a strip.
    expect(manifest({
      frames: [{ target: 'settings', id: 'board-settings', label: 'Board', layout: 'single', regions: { body: 'frame' } }],
      extensionPoints: [point({ surface: 'board-settings' })],
    }).success).toBe(false)
  })

  it('refuses a location this acorn has no host for', () => {
    expect(manifest({ frames: [PANE], extensionPoints: [point({ location: 'pane.header' })] }).success).toBe(false)
  })

  it('refuses two points at the same place on the same surface', () => {
    expect(messages(manifest({
      frames: [PANE],
      extensionPoints: [point(), point({ id: 'other' })],
    }))).toContain("'board' already has an extension point at 'pane.footer'")
  })

  // ── The aside: a region the user fills (docs/dashboards.md § Placements) ────────────────────

  it('accepts an aside beside the same pane that has a footer, and defaults its allowances', () => {
    const parsed = manifest({
      frames: [PANE],
      extensionPoints: [point(), point({ id: 'panels', location: 'pane.aside' })],
    })
    // Two locations, two contributors, so the one-per-(surface, location) rule leaves room for both.
    expect(parsed.success && parsed.data.contributions.extensionPoints[1]!.panels).toBeUndefined()
    const declared = manifest({
      frames: [PANE],
      extensionPoints: [point({ location: 'pane.aside', panels: {} })],
    })
    // Declaring the key and nothing inside it is the whole opt-in: own collections, every view, four.
    expect(declared.success && declared.data.contributions.extensionPoints[0]!.panels).toEqual({ max: 4 })
  })

  it('refuses panels on a footer, whose contributors are other plugins', () => {
    expect(messages(manifest({ frames: [PANE], extensionPoints: [point({ panels: {} })] })))
      .toContain("panels is only valid on a 'pane.aside' extension point")
  })

  it('refuses a region that names collections and a field role at once', () => {
    expect(messages(manifest({
      frames: [PANE],
      extensionPoints: [point({ location: 'pane.aside', panels: { collections: ['a:b'], fieldRole: 'status' } })],
    }))).toContain('a panel region names collections or a fieldRole, never both')
  })

  it('refuses a view kind this build has no renderer for', () => {
    expect(manifest({
      frames: [PANE],
      extensionPoints: [point({ location: 'pane.aside', panels: { views: ['sankey'] } })],
    }).success).toBe(false)
  })
})

describe('extensions', () => {
  const extension = (over: Record<string, unknown> = {}) =>
    ({ id: 'board-issues', point: 'tracker:card-links', label: 'Issues', items: '/v2/p/board/issues', ...over })

  it('accepts a contribution naming another plugin’s point, and defaults its order', () => {
    const parsed = manifest({ extensions: [extension()] })
    expect(parsed.success && parsed.data.contributions.extensions[0]!.order).toBe(500)
  })

  it('refuses a point reference that is not one', () => {
    // An unqualified name can never resolve. A point's public id is minted by the host from the owner's
    // plugin id, so a contribution that does not name the owner is naming nothing.
    for (const point of ['card-links', 'tracker:', ':card-links', 'Tracker:Card-Links', 'a:b:c']) {
      expect(manifest({ extensions: [extension({ point })] }).success, point).toBe(false)
    }
  })

  it('confines the items route to this plugin’s own namespace', () => {
    // This is "reading another plugin's routes", refused at the earliest possible moment. The point
    // owner's namespace is exactly the one a hostile contribution would name.
    expect(messages(manifest({ extensions: [extension({ items: '/v2/p/tracker/cards' })] })))
      .toContain('route must be inside /v2/p/board/')
    expect(messages(manifest({ extensions: [extension({ items: '/v2/core/tasks' })] })))
      .toContain('route must be inside /v2/p/board/')
  })

  it('takes the context-free verb set only, checked against this manifest’s own surfaces', () => {
    // The click site is inside another plugin's pane: there is no rail row to promote and no project of
    // this plugin's to navigate within.
    expect(manifest({ extensions: [extension({ onSelect: { verb: 'createTask' } })] }).success).toBe(false)
    expect(messages(manifest({ extensions: [extension({ onSelect: { verb: 'openPane', pane: 'ghost' } })] })))
      .toContain("openPane names 'ghost', which this manifest does not declare as a task-scoped pane")
    expect(manifest({
      frames: [PANE],
      extensions: [extension({ onSelect: { verb: 'openPane', pane: 'board' } })],
    }).success).toBe(true)
  })

  it('caps the list and counts its ids in the one-id-per-contribution rule', () => {
    // Sixteen since the one key grew from rows to five kinds: a plugin that opens a pane, a slot in it,
    // a hook before it acts and an annotation on its rows is describing one integration, not four.
    expect(manifest({ extensions: Array.from({ length: 16 }, (_, i) => extension({ id: `e-${i}` })) }).success).toBe(true)
    expect(manifest({ extensions: Array.from({ length: 17 }, (_, i) => extension({ id: `e-${i}` })) }).success).toBe(false)
    expect(messages(manifest({ extensions: [extension(), extension()] }))).toContain("duplicate contribution id 'board-issues'")
  })
})

describe('the five kinds', () => {
  // `kind` decides which of two lists a point's fields fall into: what it must name, and what naming
  // would parse and never be read. Both halves matter, because the failure this whole file exists to
  // refuse is a declaration that installs, looks fine, and can never do anything.
  const kindPoint = (over: Record<string, unknown>) =>
    manifest({ frames: [PANE], extensionPoints: [{ id: 'p', label: 'P', ...over }] })

  it('reads a manifest with no kind as rows, so everything written before this parses unchanged', () => {
    const parsed = manifest({ frames: [PANE], extensionPoints: [{ id: 'p', label: 'P', location: 'pane.footer', surface: 'board' }] })
    expect(parsed.success && parsed.data.contributions.extensionPoints[0]!.kind).toBe('rows')
  })

  it('makes an annotation say what its items are keyed by, and refuses a location on one', () => {
    expect(kindPoint({ kind: 'annotation', key: { file: 'string', line: 'number' } }).success).toBe(true)
    expect(messages(kindPoint({ kind: 'annotation' }))).toContain("a 'annotation' extension point declares key")
    expect(messages(kindPoint({ kind: 'annotation', key: { file: 'string' }, location: 'pane.footer', surface: 'board' })))
      .toContain("location is not read on a 'annotation' extension point")
  })

  it('makes a remote point say how it arbitrates, and gives it no location to draw at', () => {
    expect(kindPoint({ kind: 'remote', mode: 'replace', selector: 'mime' }).success).toBe(true)
    expect(messages(kindPoint({ kind: 'remote' }))).toContain("a 'remote' extension point declares mode")
  })

  it('makes a rectangle take an inline location and nothing else', () => {
    expect(kindPoint({ kind: 'rectangle', mode: 'replace', location: 'pane.inline-beside', surface: 'board' }).success).toBe(true)
    // The location is what the host reads to decide which host draws the point at all, so a rows point
    // and a rectangle point may not take each other's names.
    expect(messages(kindPoint({ kind: 'rectangle', mode: 'replace', location: 'pane.footer', surface: 'board' })))
      .toContain("'pane.footer' is not a location a 'rectangle' extension point can take")
    expect(messages(kindPoint({ kind: 'rows', location: 'pane.inline-below', surface: 'board' })))
      .toContain("'pane.inline-below' is not a location a 'rows' extension point can take")
  })

  it('makes a hook declare its payload and what is allowed at it', () => {
    expect(kindPoint({ kind: 'hook', payload: { branch: 'string' }, allows: ['veto'] }).success).toBe(true)
    expect(messages(kindPoint({ kind: 'hook', allows: ['veto'] }))).toContain("a 'hook' extension point declares payload")
    expect(messages(kindPoint({ kind: 'hook', payload: { branch: 'string' } }))).toContain("a 'hook' extension point declares allows")
    // A payload type this build has no vocabulary for. The tree's prop vocabulary and nothing else.
    expect(kindPoint({ kind: 'hook', payload: { branch: 'blob' }, allows: ['veto'] }).success).toBe(false)
  })

  it('makes a contribution name exactly one way in', () => {
    const extension = (over: Record<string, unknown>) =>
      manifest({ frames: [PANE], extensions: [{ id: 'e', point: 'other:p', label: 'E', ...over }] })
    expect(extension({ items: '/v2/p/board/rows' }).success).toBe(true)
    expect(messages(extension({}))).toContain('an extension names exactly one of items, remote, frame or route')
    expect(messages(extension({ items: '/v2/p/board/rows', route: '/v2/p/board/hook', mode: 'veto' })))
      .toContain('an extension names exactly one of items, remote, frame or route, not items and route')
  })

  it('makes a hook handler say what it asks to do, and refuses a mode on anything else', () => {
    const extension = (over: Record<string, unknown>) =>
      manifest({ frames: [PANE], extensions: [{ id: 'e', point: 'other:p', label: 'E', ...over }] })
    expect(extension({ route: '/v2/p/board/scan', mode: 'veto' }).success).toBe(true)
    expect(messages(extension({ route: '/v2/p/board/scan' })))
      .toContain('a hook handler says what it asks to do: observe, transform or veto')
    expect(messages(extension({ items: '/v2/p/board/rows', mode: 'veto' })))
      .toContain('mode is only valid on a hook handler, which names a route')
    // Confined to this plugin's own namespace, for the reason every other declared route is.
    expect(messages(extension({ route: '/v2/p/other/scan', mode: 'veto' })))
      .toContain('route must be inside /v2/p/board/')
  })

  it('makes an inline frame and the extension that places it name each other', () => {
    const withBundle = (contributions: Record<string, unknown>) =>
      pluginManifestSchema.safeParse({
        id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', client: './dist/client.js', contributions,
      })
    expect(withBundle({
      frames: [PANE, { target: 'inline', id: 'preview', label: 'Markdown preview' }],
      extensions: [{ id: 'md', point: 'editor:beside', label: 'Preview', frame: 'preview', matches: ['*.md'] }],
    }).success).toBe(true)
    // A rectangle nothing places is a box with nowhere to be drawn.
    expect(messages(withBundle({ frames: [PANE, { target: 'inline', id: 'preview', label: 'P' }] })))
      .toContain("inline frame 'preview' needs an extension placing it in another plugin's rectangle point")
    expect(messages(withBundle({
      frames: [PANE],
      extensions: [{ id: 'md', point: 'editor:beside', label: 'Preview', frame: 'ghost' }],
    }))).toContain("extension names frame 'ghost', which this manifest does not declare with target 'inline'")
  })

  it('makes a remote contribution declare the bundle it draws from', () => {
    expect(messages(manifest({
      frames: [PANE],
      extensions: [{ id: 'card', point: 'agents:tool-card', label: 'Card', remote: 'toolCard', matches: ['bash'] }],
    }))).toContain('a remote contribution runs this plugin\u2019s client bundle; declare `client` in the manifest')
  })
})

describe('the exclusive slot', () => {
  const coreSlot = (over: Record<string, unknown> = {}) =>
    ({ target: 'coreSlot', id: 'board-rail', label: 'Board task list', coreSlot: 'rail.taskList', ...over })

  const withBundle = (contributions: Record<string, unknown>) =>
    pluginManifestSchema.safeParse({
      id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', client: './dist/client.js', contributions,
    })

  it('accepts a replacement for a designated core surface', () => {
    expect(withBundle({ frames: [coreSlot()] }).success).toBe(true)
  })

  it('refuses a core surface this acorn has not designated', () => {
    expect(withBundle({ frames: [coreSlot({ coreSlot: 'topbar' })] }).success).toBe(false)
    expect(messages(withBundle({ frames: [coreSlot({ coreSlot: undefined })] })))
      .toContain('a coreSlot surface must name which core surface it replaces')
  })

  it('needs a client bundle, because the host mounts one here', () => {
    // Without one there is nothing to draw in core's place, and the trust queue holds bundles, so a
    // bundle-less package offering to replace a core surface would never reach the prompt disclosing it.
    expect(messages(manifest({ frames: [coreSlot()] })))
      .toContain('a coreSlot surface needs a client bundle; declare `client` in the manifest')
  })

  it('refuses `coreSlot` on anything that is not a coreSlot surface', () => {
    expect(messages(manifest({ frames: [{ ...PANE, coreSlot: 'rail.taskList' }] })))
      .toContain('coreSlot is only valid on a coreSlot surface')
  })

  it('is not a pane, so no verb can name it', () => {
    // `openPane` opens into a task's layout and a core surface belongs to no task. A verb that could name
    // one would be an offer that can only fail.
    expect(withBundle({
      frames: [coreSlot()],
      commands: [{ id: 'go', title: 'Go', action: { verb: 'openPane', pane: 'board-rail' } }],
    }).success).toBe(false)
  })
})

describe('forward compatibility: unknown is retained and reported', () => {
  // docs/plugins.md § Forward compatibility. A manifest written for a later acorn still loads on this
  // one; what changed is that it no longer does so in silence.
  const parse = (extra: Record<string, unknown>) =>
    parsePluginManifest({ id: 'board', name: 'Board', version: '1.0.0', apiVersion: '3', ...extra })

  it('names an unknown top-level key, contribution kind and node facet', () => {
    const result = parse({
      widgets: [],
      contributions: { panes: [], commands: [] },
      permissions: { node: { core: ['git', 'holograms'], telepathy: true } },
    })
    expect(result.ok).toBe(true)
    expect(result.ok && [...result.unknown].sort()).toEqual([
      'contributions.panes',
      'permissions.node.core: holograms',
      'permissions.node.telepathy',
      'widgets',
    ])
  })

  it('still loads it, which is the half that must not change', () => {
    const result = parse({ widgets: [], permissions: { node: { core: ['git'] } } })
    // The known facet survives, the unknown key is gone from the parsed shape, and the manifest is
    // usable. Refusing it here is what `apiVersion` used to do and what this rule exists to prevent.
    expect(result.ok && result.manifest.permissions.node.core).toEqual(['git'])
    expect(result.ok && 'widgets' in result.manifest).toBe(false)
  })

  it('reports nothing for a manifest this build understands completely', () => {
    expect(parse({ contributions: { commands: [] } })).toMatchObject({ ok: true, unknown: [] })
  })
})

// The two cross-field rules on `requires`, here for the same reason as the three above: both need `id`,
// so neither can live on the field.
describe('declared dependencies', () => {
  const requires = (plugins: unknown[]) =>
    pluginManifestSchema.safeParse({ id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', requires: { plugins } })

  it('refuses a package that requires itself', () => {
    const result = requires([{ id: 'board' }])
    expect(result.success).toBe(false)
    expect(!result.success && result.error.issues[0].message).toBe('a plugin cannot require itself')
  })

  it('refuses the same dependency twice, since the two ranges could disagree', () => {
    const result = requires([{ id: 'agents', version: '1' }, { id: 'agents', version: '2' }])
    expect(result.success).toBe(false)
    expect(!result.success && result.error.issues[0].message).toContain('required twice')
  })

  it('accepts a plain id and an id with a major range', () => {
    expect(requires([{ id: 'agents' }, { id: 'workflows', version: '2 || 3' }]).success).toBe(true)
  })

  it('refuses a range that is not the majors-only grammar', () => {
    expect(requires([{ id: 'agents', version: '^1.2.0' }]).success).toBe(false)
  })
})
