import { isInlineLocation, type ExtensionPointKind } from '@acorn/protocol/extensionPoints.ts'
import type { ManifestReferences } from './references'

export function validateExtensions(refs: ManifestReferences): void {
  const { manifest, issues: ctx, route, action, overlays, openedOverlays } = refs
  const { frames, extensionPoints, extensions } = manifest.contributions
  // Extension points attach to pane surfaces with room for another plugin's contribution.
  const pointSurfaces = new Set(frames.filter((frame) => frame.target === 'pane').map((frame) => frame.id))
  const claimedPoints = new Set<string>()
  // Each kind lists fields it requires and fields the host would ignore.
  const kindFields: Record<ExtensionPointKind, { required: readonly string[]; refused: readonly string[] }> = {
    rows: { required: ['location', 'surface'], refused: ['key', 'mode', 'selector', 'accepts', 'actions', 'payload', 'allows'] },
    annotation: { required: ['key'], refused: ['location', 'surface', 'panels', 'mode', 'selector', 'accepts', 'actions', 'payload', 'allows'] },
    remote: { required: ['mode'], refused: ['location', 'surface', 'panels', 'key', 'payload', 'allows'] },
    rectangle: { required: ['location', 'surface', 'mode'], refused: ['panels', 'key', 'actions', 'payload', 'allows'] },
    hook: { required: ['payload', 'allows'], refused: ['location', 'surface', 'panels', 'key', 'mode', 'selector', 'accepts', 'actions'] },
  }
  extensionPoints.forEach((entry, i) => {
    const at = ['contributions', 'extensionPoints', i] as (string | number)[]
    const fields = kindFields[entry.kind]
    const declared = entry as unknown as Record<string, unknown>
    for (const field of fields.required) {
      if (declared[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [...at, field], message: `a '${entry.kind}' extension point declares ${field}` })
      }
    }
    for (const field of fields.refused) {
      if (declared[field] !== undefined) {
        ctx.addIssue({ code: 'custom', path: [...at, field], message: `${field} is not read on a '${entry.kind}' extension point` })
      }
    }
    if (entry.location === undefined || entry.surface === undefined) return
    if (!pointSurfaces.has(entry.surface)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: `extension point names '${entry.surface}', which this manifest does not declare as a pane surface` })
    }
    // The host has one location for each point on a surface.
    const claim = `${entry.surface}\0${entry.location}`
    if (claimedPoints.has(claim)) {
      ctx.addIssue({ code: 'custom', path: at, message: `'${entry.surface}' already has an extension point at '${entry.location}'` })
    }
    claimedPoints.add(claim)
    // Inline and row locations use different hosts.
    if (isInlineLocation(entry.location) !== (entry.kind === 'rectangle')) {
      ctx.addIssue({ code: 'custom', path: [...at, 'location'], message: `'${entry.location}' is not a location a '${entry.kind}' extension point can take` })
    }
    // Only the aside reads panel composition.
    if (entry.panels && entry.location !== 'pane.aside') {
      ctx.addIssue({ code: 'custom', path: [...at, 'panels'], message: "panels is only valid on a 'pane.aside' extension point" })
    }
  })
  // Inline frames draw inside another plugin's extension point.
  const inlineFrames = new Set(frames.filter((frame) => frame.target === 'inline').map((frame) => frame.id))
  const placedInlineFrames = new Set<string>()
  extensions.forEach((entry, i) => {
    const at = ['contributions', 'extensions', i] as (string | number)[]
    // Route carriers cannot make the host call core or another plugin.
    if (entry.items !== undefined) {
      route(entry.items, [...at, 'items'])
      if (!manifest.node) {
        ctx.addIssue({
          code: 'custom',
          path: [...at, 'items'],
          message: 'an items extension calls a node route; declare `node` in the manifest',
        })
      }
    }
    if (entry.route !== undefined) {
      route(entry.route, [...at, 'route'])
      if (!manifest.node) {
        ctx.addIssue({
          code: 'custom',
          path: [...at, 'route'],
          message: 'a route extension calls a node route; declare `node` in the manifest',
        })
      }
    }
    if (entry.onSelect) action(entry.onSelect, [...at, 'onSelect'])
    // A remote entry names a tree in the client bundle.
    if (entry.remote !== undefined && !manifest.client) {
      ctx.addIssue({ code: 'custom', path: [...at, 'remote'], message: 'a remote contribution runs this plugin\u2019s client bundle; declare `client` in the manifest' })
    }
    if (entry.frame !== undefined) {
      if (!inlineFrames.has(entry.frame)) {
        ctx.addIssue({ code: 'custom', path: [...at, 'frame'], message: `extension names frame '${entry.frame}', which this manifest does not declare with target 'inline'` })
      }
      placedInlineFrames.add(entry.frame)
    }
    // Companion extensions can open an overlay without an action descriptor.
    if (entry.overlay !== undefined) {
      if (overlays.has(entry.overlay)) openedOverlays.add(entry.overlay)
      else ctx.addIssue({ code: 'custom', path: [...at, 'overlay'], message: `extension names overlay '${entry.overlay}', which this manifest does not declare as an overlay surface` })
    }
  })
  // An unplaced inline frame has nowhere to draw.
  frames.forEach((frame, i) => {
    if (frame.target === 'inline' && !placedInlineFrames.has(frame.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'frames', i],
        message: `inline frame '${frame.id}' needs an extension placing it in another plugin's rectangle point`,
      })
    }
  })
}
