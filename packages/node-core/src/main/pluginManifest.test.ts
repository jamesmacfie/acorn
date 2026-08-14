import { describe, expect, it } from 'vitest'
import { pluginManifestSchema } from './pluginManifest'

// The declarative-chrome half of the manifest (docs/plugins.md).
//
// What is worth pinning here is not the field list — Zod holds that — but the three cross-field rules,
// because each one is a place a manifest could otherwise name something outside itself: a route in
// someone else's namespace, a pane it never declared, a non-https URL the shell would hand to the OS.

const manifest = (contributions: Record<string, unknown>) =>
  pluginManifestSchema.safeParse({ id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', contributions })

const permissionManifest = (permissions: Record<string, unknown>) =>
  pluginManifestSchema.safeParse({ id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', permissions })

const messages = (result: ReturnType<typeof manifest>) =>
  result.success ? [] : result.error.issues.map((issue) => issue.message)

const PANE = { target: 'pane', id: 'board', label: 'Board' }

// A webview needs a client bundle to steer it, so every webview case declares one. `manifest()` stays
// bundle-less because most surfaces do not need one.
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

  it('refuses anything the `d` grammar cannot express', () => {
    // The whole trust argument for shipping path data instead of an SVG document rests on this: if a
    // mark cannot carry a tag, a url() or an event handler, there is nothing in it to sanitise.
    expect(withIcons({ icon: { d: '<script>alert(1)</script>' } }).success).toBe(false)
    expect(withIcons({ icon: { d: 'M0 0 url(https://evil.example/x)' } }).success).toBe(false)
    expect(withIcons({ icon: { d: '' } }).success).toBe(false)
    expect(withIcons({ icon: { d: `M${'0'.repeat(4_096)}` } }).success).toBe(false)
  })

  it('bounds the plural feeder, whose every entry becomes a registry row', () => {
    expect(withIcons({ icons: { openai: { d: 'M0 0Z' }, anthropic: { d: 'M1 1Z' } } }).success).toBe(true)
    expect(withIcons({ icons: { 'Not A Key': { d: 'M0 0Z' } } }).success).toBe(false)
    // A key cannot reach out of the plugin's own namespace: the host stamps `brand:<pluginId>/` in
    // front of it, so a slash here would be a second segment, not an escape — but bound it anyway.
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
    // The same rule a project-scoped pane is held to: a surface that parses and can never appear is
    // worse than a parse error, because it looks installed.
    expect(messages(manifest({ frames: [overlay] })))
      .toContain(`overlay 'files' needs an action that opens it; a command with a keybinding is the usual one`)
    expect(messages(manifest({ frames: [PANE], commands: [opener({ verb: 'openOverlay', overlay: 'board' })] })))
      .toContain(`openOverlay names 'board', which this manifest does not declare as an overlay surface`)
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
    // drive the view, so without one nothing steers it — and the trust queue holds BUNDLES, so a
    // bundle-less package never reaches the prompt at all. Its declared hosts would be a disclosure
    // nobody was ever shown, for a surface that displays arbitrary web content.
    const declared = { target: 'webview', id: 'docs', label: 'Docs', url: 'https://docs.example.com', hosts: ['docs.example.com'] }
    expect(messages(manifest({ frames: [declared] }))).toContain('a webview surface needs a client bundle; declare `client` in the manifest')
    expect(webviewManifest({ frames: [declared] }).success).toBe(true)
  })
})

describe('document surfaces', () => {
  // The host draws the editor and the plugin supplies the document, because a Monaco frame cannot be
  // served at all (docs/future/monaco.md). What is worth pinning is the same class of rule as every
  // other cross-field check here: a plugin may not name a route outside its own namespace, and a
  // surface that parses and can never do anything is refused rather than shipped.
  const layout = (document: Record<string, unknown>) => ({ ...PANE, layout: { template: 'document', document } })

  it('accepts a read/write document and defaults the language', () => {
    const result = manifest({ frames: [layout({ read: '/v2/p/board/doc', write: '/v2/p/board/doc' })] })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.frames[0]?.layout?.document.languageId).toBe('plaintext')
  })

  it('treats a missing write route as read-only rather than as an error', () => {
    const result = manifest({ frames: [layout({ read: '/v2/p/board/doc', languageId: 'sql' })] })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.frames[0]?.layout?.document.write).toBeUndefined()
  })

  it('confines both routes to the plugin, so the host cannot be made to read core on its behalf', () => {
    expect(messages(manifest({ frames: [layout({ read: '/v2/core/tasks' })] }))).toContain('route must be inside /v2/p/board/')
    expect(messages(manifest({ frames: [layout({ read: '/v2/p/board/doc', write: '/v2/p/other/doc' })] })))
      .toContain('route must be inside /v2/p/board/')
  })

  it('takes only a published language id', () => {
    expect(manifest({ frames: [layout({ read: '/v2/p/board/doc', languageId: 'brainfuck' })] }).success).toBe(false)
  })

  it('refuses a layout on a surface with no pane rectangle to split', () => {
    expect(messages(manifest({
      frames: [{ target: 'settings', id: 'board', label: 'Board', layout: { template: 'document', document: { read: '/v2/p/board/doc' } } }],
    }))).toContain('layout is only valid on a pane surface')
  })

  it('refuses key claims on the degenerate template, which draws no frame to claim them', () => {
    expect(messages(manifest({ frames: [{ ...layout({ read: '/v2/p/board/doc' }), claimsKeys: ['meta+j'] }] })))
      .toContain("the 'document' template draws no frame, so there is nothing here to claim keys")
  })

  // `document-over-frame`: a document above the plugin's own frame, host-owned splitter between them.
  // The template that arrived with its consumer (the database pane), which is what shipping the region
  // addressing on day one was for.
  const composed = (document: Record<string, unknown>) => ({ ...PANE, layout: { template: 'document-over-frame', document } })

  it('accepts the composed template, and allows the key claims the degenerate one refuses', () => {
    const result = manifest({ frames: [{ ...composed({ read: '/v2/p/board/doc', languageId: 'sql' }), claimsKeys: ['meta+j'] }] })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.frames[0]?.layout?.template).toBe('document-over-frame')
  })

  it('confines the completions route like any other, and defaults its trigger characters', () => {
    const ok = manifest({ frames: [layout({ read: '/v2/p/board/doc', completions: { route: '/v2/p/board/complete' } })] })
    expect(ok.success).toBe(true)
    expect(ok.success && ok.data.contributions.frames[0]?.layout?.document.completions?.triggerCharacters).toEqual([])
    expect(messages(manifest({ frames: [layout({ read: '/v2/p/board/doc', completions: { route: '/v2/p/other/complete' } })] })))
      .toContain('route must be inside /v2/p/board/')
  })
})

describe('surface actions', () => {
  // A command delivered into the frame region of a composed pane, because its chord is pressed in the
  // HOST's editor where the frame has no keyboard. The rule worth pinning is the one every other verb
  // has: it may only name a surface this same manifest declares, and only one that can receive it.
  const composedPane = {
    target: 'pane',
    id: 'query',
    label: 'Query',
    layout: { template: 'document-over-frame', document: { read: '/v2/p/board/doc', write: '/v2/p/board/doc' } },
  }
  const execute = (surface: string) => ({ id: 'execute', title: 'Run', action: { verb: 'surfaceAction', surface } })

  it('accepts a command aimed at a composed pane this manifest declares', () => {
    expect(manifest({ frames: [composedPane], commands: [execute('query')] }).success).toBe(true)
  })

  it('refuses a surface with no frame region to receive it', () => {
    // A plain frame pane has no document to flush and no host chord to have resolved the command…
    expect(messages(manifest({ frames: [PANE], commands: [execute('board')] })))
      .toContain("surfaceAction names 'board', which this manifest does not declare as a document-over-frame pane")
    // …and the degenerate template draws no frame at all, so there is nothing on the other side.
    const wholePane = { ...PANE, layout: { template: 'document', document: { read: '/v2/p/board/doc' } } }
    expect(messages(manifest({ frames: [wholePane], commands: [execute('board')] })))
      .toContain("surfaceAction names 'board', which this manifest does not declare as a document-over-frame pane")
  })

  it('refuses another plugin\'s surface, which is to say any it did not declare', () => {
    expect(messages(manifest({ frames: [composedPane], commands: [execute('someone-elses')] })))
      .toContain("surfaceAction names 'someone-elses', which this manifest does not declare as a document-over-frame pane")
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
    // And a pane written before `scope` existed is still a TASK pane, which is the compatibility promise
    // the whole field rests on: rollbar's manifest has to keep behaving identically.
    expect(result.success && result.data.contributions.frames[0]?.scope).toBe('task')
  })

  it('confines every route to the plugin’s own namespace', () => {
    expect(messages(manifest({ sources: [{ id: 's', label: 'S', order: 1, items: '/v2/core/tasks' }] })))
      .toEqual(['route must be inside /v2/p/board/'])
    // Another plugin's namespace is the interesting case: it looks legal and is the whole point of the check.
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
      frames: [{ target: 'settings', id: 'board-settings', label: 'Board' }],
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
    // `invoke` is a v1 non-verb (it needs a frame lifecycle the shell does not have). Failing here is the
    // point: an author is told, rather than shipping a palette row that silently does nothing.
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

  it('carries a source empty state, bounds its message and narrows its action', () => {
    const source = (emptyState: unknown) => manifest({
      frames: [PANE],
      sources: [{ id: 's', label: 'S', order: 1, items: '/v2/p/board/rail-items', emptyState }],
    })

    expect(source({ message: 'No linked projects yet.' }).success).toBe(true)
    expect(source({ message: 'Nothing to show.', action: { verb: 'openPane', pane: 'board' }, actionLabel: 'Open board' }).success).toBe(true)

    // The two verbs an empty rail cannot carry, and the reason is the rail being EMPTY: `createTask`
    // promotes a selected row and `navigate` substitutes a routed project into a surface path, and a
    // state that renders in place of the list has neither.
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

    // The escape that matters here is naming ANOTHER plugin's resolver: the host POSTs identifiers to
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
    // `openPane` is optional because a plugin can have items worth glancing at and no task pane at all. The
    // panel is addressed by provider, and a refPanel's provider is already the plugin id, so declaring one is
    // the whole declaration.
    expect(manifest({
      frames: [{ target: 'refPanel', id: 'board-ref', label: 'Card', providerId: 'board' }],
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
const PROJECT_PANE = { target: 'pane', id: 'board-card', label: 'Card', scope: 'project' }
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
    // Not a path at all, and a path leaving the origin, both report the same confinement failure.
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, path: 'cards/:key' }] })))
      .toContain('route must be inside /p/:projectId/x/board/')
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, path: '//evil.example/p/:projectId/x/board/cards/:key' }] })))
      .toContain('route must be inside /p/:projectId/x/board/')
  })

  it('rejects a route naming a surface this manifest does not declare as project-scoped', () => {
    expect(messages(manifest({ routes: [PROJECT_ROUTE] })))
      .toContain(`route names 'board-card', which this manifest does not declare as a project-scoped pane`)
    // A TASK pane is not addressable this way either: its selection lives in the task's layout, and the
    // surface it would mount into does not exist outside one.
    expect(messages(manifest({
      frames: [PANE],
      routes: [{ ...PROJECT_ROUTE, surface: 'board' }],
    }))).toContain(`route names 'board', which this manifest does not declare as a project-scoped pane`)
  })

  it('requires the addressed item to be a parameter of the path, and never projectId', () => {
    expect(messages(manifest({ frames: [PROJECT_PANE], sources: [PROJECT_SOURCE], routes: [{ ...PROJECT_ROUTE, item: 'identifier' }] })))
      .toContain(`route item 'identifier' must be a :param of its path other than projectId`)
    // `projectId` IS a parameter of every such path, and it is the host's — bound before a plugin sees it.
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
    expect(messages(manifest({ frames: [{ target: 'settings', id: 'board-settings', label: 'Board', scope: 'project' }] })))
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
