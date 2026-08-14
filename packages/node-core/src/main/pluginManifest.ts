// `acorn-plugin.json` — the file at the root of an installed plugin package, and the only thing the
// loader trusts about it (docs/plugins.md).
//
// The STRUCTURE is declared once, in @acorn/protocol/pluginContract.ts, because the client needs the
// same shape to register contributions from a roster row and neither side may import the other. What
// stays here is the half that is the node's alone: the cross-field rules below, which need `id` and
// the frame list, and the reader that turns a directory into a manifest or into nothing.
//
// It arrives from disk rather than from the wire, and it is still parsed with a module-level Zod
// schema and `safeParse` (docs/architecture-overview.md § wire validation). Disk is a trust boundary
// here for the same reason a request body is: the bytes were written by someone other than us, and
// everything downstream — a route namespace, a SQLite filename, a set of CoreServices facets — is
// bound from what this file says.
//
// The HOST binds every namespace from `id`. `plugin.name` inside the bundle is checked to match and
// otherwise ignored, so a bundle cannot mount itself under another plugin's prefix by lying.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import { compileContentLinkPattern } from '@acorn/protocol/contentLinkPattern.ts'
import { isPluginOpenableUrl } from '@acorn/protocol/externalUrl.ts'
import { isAllowedWebviewUrl } from '@acorn/protocol/webview.ts'
import {
  isOverlaySurface,
  isProjectPaneSurface,
  isTaskPaneSurface,
  pluginManifestShape,
  type PluginChromeAction,
} from '@acorn/protocol/pluginContract.ts'

// Re-exported so this file stays the one import for everything manifest-shaped. The declarations
// themselves live in @acorn/protocol: the node uses them to decide what to LOAD, the client to decide
// which of a fleet's bundles it can RUN (client-core/plugins/resolveBundles.ts), and one compatibility
// contract cannot live on one side.
export { PLUGIN_API_MAJOR } from '@acorn/protocol/pluginApiVersion.ts'
export type {
  NodePermissions,
  PluginAgentContextDescriptor,
  PluginChromeAction,
  PluginClientRouteDescriptor,
  PluginCommandDescriptor,
  PluginDocumentRegion,
  PluginFrameSurface,
  PluginKeybindingDescriptor,
  PluginPaneLayout,
  PluginRefResolverDescriptor,
} from '@acorn/protocol/pluginContract.ts'

// Cross-field checks, which is why they are here and not on the fields: every one of them needs
// either `id` or the frame list, and neither is visible from inside a nested schema.
//
// All three are the same idea the rest of the file already applies — THE HOST BINDS EVERY NAMESPACE
// — moved to the one place a manifest can name things outside itself. A descriptor route is the
// parse-time twin of the bridge's runtime confinement (client-core/plugins/frames/scopes.ts): a
// plugin may address its own `/v2/p/<id>/` prefix and nothing else, so it cannot make the host read
// core routes, or another plugin's, on its behalf.
export const pluginManifestSchema = pluginManifestShape.superRefine((manifest, ctx) => {
  const { frames, sources, slots, palette, commands, keybindings, attention, nodeStats, contentLinks, agentContexts, refResolvers, routes } = manifest.contributions
  const own = `/v2/p/${manifest.id}/`
  // The RENDERER twin of `own`. Re-spelled here rather than imported, exactly as client-core re-spells
  // `/v2/p/` (plugins/chrome/data.ts states the argument): the authority for core's URL shapes is
  // client-core/registries/corePaths.ts, and node-core does not depend on the client.
  //
  // `x` is a reserved segment, and reserving it is what makes collision a parse error instead of a race.
  // It cannot collide with core's `/p/:projectId` or `/p/:projectId/new`, nor with a compiled plugin's
  // own pattern (github's `/p/:projectId/pulls`); and because exactly one bundle wins per plugin id, two
  // loaded plugins cannot land on the same prefix either.
  const ownPath = `/p/:projectId/x/${manifest.id}/`
  // Classified by the contract's own predicates, which the CLIENT also uses to build the runtime
  // `openPane` allowlist (@acorn/protocol/pluginContract.ts). This used to be a third hand-spelling of
  // the same rule, excused by a comment saying the node could not import the client's — true when the
  // shape lived in two places, and false since the manifest became one declaration both sides read.
  //
  // It was also subtly the wrong rule: this spelled task panes `scope === 'task'` where the client
  // spelled them `scope !== 'project'`. Identical here, because the schema has already applied the
  // `'task'` default by the time a refinement runs — and different on the client, which reads the
  // field off a roster row where an older node may never have set it.
  const taskPanes = new Set(frames.filter(isTaskPaneSurface).map((frame) => frame.id))
  const projectPanes = new Set(frames.filter(isProjectPaneSurface).map((frame) => frame.id))
  const overlays = new Set(frames.filter(isOverlaySurface).map((frame) => frame.id))
  // Panes with BOTH a host region and a frame region, which is the only place a surface action has to
  // land. The degenerate `document` template is excluded on purpose: it draws no frame, so a command
  // targeting it would parse and then post into nothing.
  const composedPanes = new Set(
    frames.filter((frame) => frame.target === 'pane' && frame.layout?.template === 'document-over-frame').map((frame) => frame.id),
  )

  const confine = (path: string, prefix: string, at: (string | number)[]): void => {
    let confined = false
    try {
      const url = new URL(path, 'https://acorn.invalid')
      confined = path.startsWith('/') && url.origin === 'https://acorn.invalid' && url.pathname.startsWith(prefix)
    } catch {
      // Report the same confinement error for malformed and escaped paths.
    }
    if (!confined) ctx.addIssue({ code: 'custom', path: at, message: `route must be inside ${prefix}` })
  }

  const route = (path: string, at: (string | number)[]): void => confine(path, own, at)

  // Filled by `action` below, and read after every descriptor pass has run: an overlay has no click site
  // of its own, so a declared one that nothing opens is the same "parses and can never appear" failure
  // the project-scoped pane checks at the bottom of this function refuse.
  const openedOverlays = new Set<string>()

  const action = (value: PluginChromeAction, at: (string | number)[]): void => {
    // A pane the manifest did not declare is a manifest error, not a runtime surprise — and it cannot
    // name another plugin's pane, because the host only ever registers panes this manifest declared.
    //
    // TASK-scoped only, because that is what this verb does: it pushes a pane into a task's layout. A
    // project-scoped surface has `navigate`, and the two sets are disjoint, so neither verb can reach a
    // surface it would only fail on.
    if (value.verb === 'openPane' && !taskPanes.has(value.pane)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'pane'], message: `openPane names '${value.pane}', which this manifest does not declare as a task-scoped pane` })
    }
    if (value.verb === 'navigate' && !projectPanes.has(value.surface)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: `navigate names '${value.surface}', which this manifest does not declare as a project-scoped pane` })
    }
    if (value.verb === 'openOverlay') {
      if (overlays.has(value.overlay)) openedOverlays.add(value.overlay)
      else ctx.addIssue({ code: 'custom', path: [...at, 'overlay'], message: `openOverlay names '${value.overlay}', which this manifest does not declare as an overlay surface` })
    }
    // The frame region is what receives it, so the degenerate template is not a candidate — and neither
    // is a plain frame pane, which has no document to flush and no host chord to have resolved this.
    if (value.verb === 'surfaceAction' && !composedPanes.has(value.surface)) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'surface'],
        message: `surfaceAction names '${value.surface}', which this manifest does not declare as a document-over-frame pane`,
      })
    }
    if (value.verb === 'runNodeAction') route(value.path, [...at, 'path'])
    // `openUrl` reaches the real browser. Anything but https is either a downgrade or a scheme handler,
    // and neither is a thing a descriptor gets to choose for the user. Shared with the frame bridge's
    // `ui.openUrl` verb rather than restated, because a plugin asking the host to open a URL is one
    // policy however it asks (@acorn/protocol/externalUrl.ts).
    if (value.verb === 'openUrl' && !isPluginOpenableUrl(value.url)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'url'], message: 'openUrl must be https' })
    }
  }

  frames.forEach((frame, i) => {
    const at = ['contributions', 'frames', i] as (string | number)[]
    // Nothing but a pane has two scopes: a refPanel is opened by whoever renders the item, settings and
    // importer are modals the host puts on screen, and a webview is a pane by another name.
    if (frame.scope === 'project' && frame.target !== 'pane') {
      ctx.addIssue({ code: 'custom', path: [...at, 'scope'], message: 'only a pane surface can be project-scoped' })
    }
    if (frame.layout) {
      // A template splits a PANE rectangle. A settings page, an importer, a reference panel and an
      // overlay are all chrome the host already draws around a frame, and a webview's pixels are not
      // the renderer's at all — none of them has a rectangle to split.
      if (frame.target !== 'pane') {
        ctx.addIssue({ code: 'custom', path: [...at, 'layout'], message: 'layout is only valid on a pane surface' })
      }
      route(frame.layout.document.read, [...at, 'layout', 'document', 'read'])
      if (frame.layout.document.write) route(frame.layout.document.write, [...at, 'layout', 'document', 'write'])
      if (frame.layout.document.completions) {
        route(frame.layout.document.completions.route, [...at, 'layout', 'document', 'completions', 'route'])
      }
      // The degenerate template has no frame region, so this plugin's bundle draws nothing in this
      // pane — there is no iframe to hold a chord and forward the rest. Declaring claims here would
      // parse and then capture nothing, which is the failure this file spends its length refusing.
      // The check is on the template rather than on `layout`, because `document-over-frame` DOES have
      // a frame and its claims will be real.
      if (frame.layout.template === 'document' && frame.claimsKeys.length) {
        ctx.addIssue({
          code: 'custom',
          path: [...at, 'claimsKeys'],
          message: "the 'document' template draws no frame, so there is nothing here to claim keys",
        })
      }
    }
    if (frame.target !== 'webview') {
      if (frame.url !== undefined || frame.urlSource !== undefined || frame.hosts !== undefined) {
        ctx.addIssue({ code: 'custom', path: at, message: 'url, urlSource and hosts are only valid on a webview surface' })
      }
      return
    }
    if ((frame.url === undefined) === (frame.urlSource === undefined)) {
      ctx.addIssue({ code: 'custom', path: at, message: 'a webview must declare exactly one of url or urlSource' })
    }
    if (!frame.hosts?.length) {
      ctx.addIssue({ code: 'custom', path: [...at, 'hosts'], message: 'a webview must declare at least one host' })
    }
    // A webview needs the package's client bundle: the host mounts it controller-only to drive the
    // view (client-core/plugins/frames/PluginWebview.tsx), so without one the surface renders a view
    // nothing steers.
    //
    // It is also the only reason the owner is ever asked about the host grant. The trust queue holds
    // BUNDLES, so a bundle-less package never reaches the prompt — and its declared `hosts` would then
    // be a disclosure nobody was shown, for a surface displaying arbitrary web content. The device
    // refuses to mount one either way (client-core/plugins/contributions.ts); refusing it here turns a
    // pane that silently never appears into an error the author sees at install time.
    if (!manifest.client) {
      ctx.addIssue({ code: 'custom', path: at, message: 'a webview surface needs a client bundle; declare `client` in the manifest' })
    }
    if (frame.urlSource) route(frame.urlSource, [...at, 'urlSource'])
    if (frame.url && frame.hosts?.length && !isAllowedWebviewUrl(frame.url, frame.hosts)) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'url'],
        message: 'webview url must use https (or loopback http) and match a declared host',
      })
    }
  })
  sources.forEach((entry, i) => {
    route(entry.items, ['contributions', 'sources', i, 'items'])
    if (entry.onSelect) action(entry.onSelect, ['contributions', 'sources', i, 'onSelect'])
    if (entry.emptyState?.action) action(entry.emptyState.action, ['contributions', 'sources', i, 'emptyState', 'action'])
  })
  slots.forEach((entry, i) => {
    route(entry.data, ['contributions', 'slots', i, 'data'])
    if (entry.onClick) action(entry.onClick, ['contributions', 'slots', i, 'onClick'])
  })
  palette.forEach((entry, i) => action(entry.action, ['contributions', 'palette', i, 'action']))
  commands.forEach((entry, i) => action(entry.action, ['contributions', 'commands', i, 'action']))
  const commandIds = new Set([...commands, ...palette].map((entry) => entry.id))
  const surfaceIds = new Set(frames.map((frame) => frame.id))
  const boundCommands = new Set<string>()
  keybindings.forEach((entry, i) => {
    const at = ['contributions', 'keybindings', i] as (string | number)[]
    if (!commandIds.has(entry.command)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'command'], message: `keybinding names undeclared command '${entry.command}'` })
    }
    if (boundCommands.has(entry.command)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'command'], message: `command '${entry.command}' has more than one keybinding` })
    }
    boundCommands.add(entry.command)
    if (entry.when === 'surface') {
      if (!entry.surface) {
        ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: 'surface is required when a keybinding uses surface scope' })
      } else if (!surfaceIds.has(entry.surface)) {
        ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: `keybinding names undeclared surface '${entry.surface}'` })
      }
    } else if (entry.surface !== undefined) {
      ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: 'surface is only valid with surface scope' })
    }
  })
  attention.forEach((entry, i) => route(entry.items, ['contributions', 'attention', i, 'items']))
  nodeStats.forEach((entry, i) => route(entry.data, ['contributions', 'nodeStats', i, 'data']))
  agentContexts.forEach((entry, i) => {
    route(entry.options, ['contributions', 'agentContexts', i, 'options'])
    route(entry.capture, ['contributions', 'agentContexts', i, 'capture'])
  })
  refResolvers.forEach((entry, i) => route(entry.resolve, ['contributions', 'refResolvers', i, 'resolve']))
  // Every project-scoped surface needs two things this manifest alone can supply, and both are checked
  // here rather than left to a runtime that would have nothing to say about them.
  const routedSurfaces = new Set<string>()
  routes.forEach((entry, i) => {
    const at = ['contributions', 'routes', i] as (string | number)[]
    confine(entry.path, ownPath, [...at, 'path'])
    if (!projectPanes.has(entry.surface)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: `route names '${entry.surface}', which this manifest does not declare as a project-scoped pane` })
    } else {
      routedSurfaces.add(entry.surface)
    }
    const params = new Set(entry.path.split('/').flatMap((segment) => segment.startsWith(':') ? [segment.slice(1)] : []))
    if (entry.item === 'projectId' || !params.has(entry.item)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'item'], message: `route item '${entry.item}' must be a :param of its path other than projectId` })
    }
  })
  // A source's `navigate` is the only thing that mounts a project-scoped surface, and a `routes` entry is
  // the only address it has. Declaring one without either is a surface that parses and can never appear,
  // which is the failure mode this file spends the rest of its length avoiding.
  const navigatedSurfaces = new Set(sources.flatMap((entry) => entry.onSelect?.verb === 'navigate' ? [entry.onSelect.surface] : []))
  frames.forEach((frame, i) => {
    if (frame.target === 'overlay' && !openedOverlays.has(frame.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'frames', i],
        message: `overlay '${frame.id}' needs an action that opens it; a command with a keybinding is the usual one`,
      })
    }
    if (frame.target !== 'pane' || frame.scope !== 'project') return
    const at = ['contributions', 'frames', i] as (string | number)[]
    if (!routedSurfaces.has(frame.id)) {
      ctx.addIssue({ code: 'custom', path: at, message: `project-scoped pane '${frame.id}' needs a routes entry; it has no other address` })
    }
    if (!navigatedSurfaces.has(frame.id)) {
      ctx.addIssue({ code: 'custom', path: at, message: `project-scoped pane '${frame.id}' needs a source whose onSelect navigates to it; it has nowhere else to mount` })
    }
  })
  // A reference panel is addressed by provider and a panel's provider must be the plugin itself, so
  // "this manifest declares a panel" is all a content link needs to have that destination available.
  const declaresRefPanel = frames.some((frame) => frame.target === 'refPanel')
  contentLinks.forEach((entry, i) => {
    const at = ['contributions', 'contentLinks', i] as (string | number)[]
    // Task-scoped when named, because that rung opens a pane in the active task's layout
    // (client-core/registries/contentLinks.ts).
    if (entry.openPane !== undefined && !taskPanes.has(entry.openPane)) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'openPane'],
        message: `content link names '${entry.openPane}', which this manifest does not declare as a task-scoped pane`,
      })
    }
    // The same rule the project-scoped pane check above states, applied to the other direction: a
    // contribution that parses and can never do anything is worse than a parse error, because it looks
    // installed. A recogniser with neither destination would match a URL, hand the host a target with
    // nowhere to put it, and fall through to the browser on every click.
    if (entry.openPane === undefined && !declaresRefPanel) {
      ctx.addIssue({
        code: 'custom',
        path: at,
        message: `content link '${entry.id}' has nowhere to open: declare openPane, or a refPanel surface for this plugin's items`,
      })
    }
    try {
      const compiled = compileContentLinkPattern(entry.match)
      if (!compiled.captures.includes(entry.item)) {
        ctx.addIssue({
          code: 'custom',
          path: ['contributions', 'contentLinks', i, 'item'],
          message: `content link item '${entry.item}' is not captured by its match pattern`,
        })
      }
    } catch {
      // The field refinement already reports the grammar error at `match`.
    }
  })

  // Ids are per-registry on the client, but a plugin that reuses one across its own descriptors is
  // ambiguous about which contribution a query key or a disposal refers to. Cheap to forbid outright.
  const seen = new Set<string>()
  for (const entry of [...frames, ...sources, ...slots, ...palette, ...commands, ...attention, ...nodeStats, ...contentLinks, ...agentContexts, ...refResolvers, ...routes]) {
    if (seen.has(entry.id)) ctx.addIssue({ code: 'custom', path: ['contributions'], message: `duplicate contribution id '${entry.id}'` })
    seen.add(entry.id)
  }
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>

export const MANIFEST_FILE = 'acorn-plugin.json'

// How many Zod issues a rejected manifest reports. A manifest that violates thirty rules is a manifest
// nobody has run yet; the first few name the file well enough to start, and the whole list would push a
// paragraph through the roster row and the attention bell.
const MAX_REPORTED_ISSUES = 3

export type PluginManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; reason: string }

/** The schema, run against an already-parsed object, with the issue paths kept.
 *
 * Split out of the reader below so there is one place that turns Zod issues into a sentence a human can
 * act on. The other caller is testkit/manifest.ts, which validates a plugin's `acorn-plugin.config.mjs`
 * at `pnpm test` time — the same rules, one step earlier, against the source the author edits rather
 * than the JSON the builder writes.
 *
 * `source` only names the file in the message; the rules are the same wherever the bytes came from. */
export function parsePluginManifest(json: unknown, source: string = MANIFEST_FILE): PluginManifestResult {
  const parsed = pluginManifestSchema.safeParse(json)
  if (parsed.success) return { ok: true, manifest: parsed.data }
  // `path + message`, which is the whole point: `contributions.commands[2].run: ...` tells an author
  // which line to open. A path-less issue (the schema's own cross-field refinements sometimes are) reads
  // as the bare message rather than as an empty prefix.
  const issues = parsed.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('').replace(/^\./, '')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  const extra = parsed.error.issues.length - issues.length
  return { ok: false, reason: `${source} does not match the manifest schema — ${issues.join('; ')}${extra > 0 ? ` (and ${extra} more)` : ''}` }
}

/** Why this directory is not a plugin, in the words of the rule it broke.
 *
 * The pair to `readPluginManifest` below, which collapses every one of these to `null`. That collapse is
 * what made a bad manifest the least debuggable failure in the system: the loader could only say
 * "missing, unreadable, or does not match the schema", so an author who mistyped one field went looking
 * through ~30 rules by hand.
 *
 * Still never throws. A skip plus a report is the loader's contract and this only changes what the report
 * can say. */
export function readPluginManifestResult(dir: string): PluginManifestResult {
  let text: string
  try {
    text = readFileSync(join(dir, MANIFEST_FILE), 'utf8')
  } catch (error) {
    return { ok: false, reason: `${MANIFEST_FILE} is missing or unreadable: ${error instanceof Error ? error.message : String(error)}` }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: `${MANIFEST_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  return parsePluginManifest(json)
}

// Never throws. A missing, unreadable, non-JSON or schema-violating manifest is all one outcome —
// "this directory is not a plugin we can run" — and the loader turns that into a skip plus a report.
// Callers that have somewhere to PUT the reason use readPluginManifestResult above instead.
export function readPluginManifest(dir: string): PluginManifest | null {
  const result = readPluginManifestResult(dir)
  return result.ok ? result.manifest : null
}
