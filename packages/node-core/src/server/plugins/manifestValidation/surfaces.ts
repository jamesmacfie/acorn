import { compileContentLinkPattern } from '@acorn/protocol/contentLinkPattern.ts'
import { isAllowedWebviewUrl } from '@acorn/protocol/webview.ts'
import { hasFrameRegion } from '@acorn/protocol/plugin/contract.ts'
import type { ManifestReferences } from './references'

export function validateFrames(refs: ManifestReferences): void {
  const { manifest, issues: ctx, route } = refs
  const { frames } = manifest.contributions
  frames.forEach((frame, i) => {
    const at = ['contributions', 'frames', i] as (string | number)[]
    // Only panes can be project scoped.
    if (frame.scope === 'project' && frame.target !== 'pane') {
      ctx.addIssue({ code: 'custom', path: [...at, 'scope'], message: 'only a pane surface can be project-scoped' })
    }
    // These surfaces need a layout so the host can place their regions.
    if (!frame.layout && (frame.target === 'pane' || frame.target === 'refPanel' || frame.target === 'settings')) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'layout'],
        message: `a ${frame.target} surface says how it is drawn: name a layout, and a region of 'frame' if its body is your own rectangle`,
      })
    }
    if (frame.layout) {
      // The host draws chrome around reference panels and settings pages, leaving one region.
      if (frame.target === 'refPanel' || frame.target === 'settings' || frame.target === 'coreSlot') {
        if (frame.layout !== 'single') {
          ctx.addIssue({
            code: 'custom',
            path: [...at, 'layout'],
            message: `a ${frame.target === 'refPanel' ? 'reference panel' : frame.target === 'settings' ? 'settings page' : 'core replacement'}'s only layout is 'single': the host draws everything around it`,
          })
        }
      } else if (frame.target !== 'pane') {
        ctx.addIssue({ code: 'custom', path: [...at, 'layout'], message: 'layout is only valid on a pane, a reference panel or a settings page' })
      }
      for (const [name, region] of Object.entries(frame.regions ?? {})) {
        // Frame and remote regions refer to the client bundle, not a node route.
        if (region === 'frame' || region.kind === 'remote') continue
        const where = [...at, 'regions', name]
        route(region.read, [...where, 'read'])
        if (region.write) route(region.write, [...where, 'write'])
        if (region.completions) route(region.completions.route, [...where, 'completions', 'route'])
      }
      // A tree sees keys through the shell; only a frame can claim keys from its own document.
      if (!hasFrameRegion(frame) && frame.claimsKeys.length) {
        ctx.addIssue({
          code: 'custom',
          path: [...at, 'claimsKeys'],
          message: 'this pane draws no frame, so there is nothing here to claim keys',
        })
      }
    }
    if (frame.availability) route(frame.availability, [...at, 'availability'])
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
    // The client bundle controls the webview and triggers the host grant prompt.
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
}

export function validateSurfaceDestinations(refs: ManifestReferences, ownPath: string): void {
  const { manifest, issues: ctx, confine, openedOverlays, projectPanes, taskPanes } = refs
  const { frames, routes, sources, commands, contentLinks } = manifest.contributions
  // A core replacement needs a target slot and bundle before it can displace core UI.
  frames.forEach((frame, i) => {
    const at = ['contributions', 'frames', i] as (string | number)[]
    if (frame.target === 'coreSlot') {
      if (!frame.coreSlot) {
        ctx.addIssue({ code: 'custom', path: [...at, 'coreSlot'], message: 'a coreSlot surface must name which core surface it replaces' })
      }
      if (!manifest.client) {
        ctx.addIssue({ code: 'custom', path: at, message: 'a coreSlot surface needs a client bundle; declare `client` in the manifest' })
      }
    } else if (frame.coreSlot !== undefined) {
      ctx.addIssue({ code: 'custom', path: [...at, 'coreSlot'], message: 'coreSlot is only valid on a coreSlot surface' })
    }
  })
  // A project pane needs a route and a navigation source to make it reachable.
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
  // Source rows and search results can both navigate to project panes.
  const navigatedSurfaces = new Set([
    ...sources.flatMap((entry) => entry.onSelect?.verb === 'navigate' ? [entry.onSelect.surface] : []),
    ...commands.flatMap((entry) => entry.kind === 'search' && entry.onSelect.verb === 'navigate' ? [entry.onSelect.surface] : []),
  ])
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
  // A content link may target any reference panel declared by its own plugin.
  const declaresRefPanel = frames.some((frame) => frame.target === 'refPanel')
  contentLinks.forEach((entry, i) => {
    const at = ['contributions', 'contentLinks', i] as (string | number)[]
    // A content link opens a task pane in the active task's layout.
    if (entry.openPane !== undefined && !taskPanes.has(entry.openPane)) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'openPane'],
        message: `content link names '${entry.openPane}', which this manifest does not declare as a task-scoped pane`,
      })
    }
    // Without a pane or reference panel, the link has nowhere to open.
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
}
