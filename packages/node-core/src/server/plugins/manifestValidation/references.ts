import type { z } from 'zod'
import { isPluginOpenableUrl } from '@acorn/protocol/externalUrl.ts'
import {
  hasFrameRegion,
  hasRemoteRegion,
  isOverlaySurface,
  isProjectPaneSurface,
  isTaskPaneSurface,
  pluginManifestShape,
  type PluginChromeAction,
} from '@acorn/protocol/plugin/contract.ts'

export type ManifestInput = z.output<typeof pluginManifestShape>
export type IssueSink = {
  addIssue(issue: { code: 'custom'; path: (string | number)[]; message: string }): void
}

// Resolves references between descriptors in one parsed manifest. The same instance is used for
// every validation pass so an action can mark an overlay as reachable before the final check.
export class ManifestReferences {
  readonly taskPanes: Set<string>
  readonly projectPanes: Set<string>
  readonly overlays: Set<string>
  readonly openedOverlays = new Set<string>()
  private readonly actionPanes: Set<string>
  private readonly ownRoute: string

  constructor(readonly manifest: ManifestInput, readonly issues: IssueSink) {
    const { frames } = manifest.contributions
    this.ownRoute = `/v1/p/${manifest.id}/`
    this.taskPanes = new Set(frames.filter(isTaskPaneSurface).map((frame) => frame.id))
    this.projectPanes = new Set(frames.filter(isProjectPaneSurface).map((frame) => frame.id))
    this.overlays = new Set(frames.filter(isOverlaySurface).map((frame) => frame.id))
    // A surface action needs a plugin-drawn region to receive the bridge message.
    this.actionPanes = new Set(frames
      .filter((frame) => frame.target === 'pane' && (hasFrameRegion(frame) || hasRemoteRegion(frame)))
      .map((frame) => frame.id))
  }

  confine = (path: string, prefix: string, at: (string | number)[]): void => {
    let confined = false
    try {
      const url = new URL(path, 'https://acorn.invalid')
      confined = path.startsWith('/') && url.origin === 'https://acorn.invalid' && url.pathname.startsWith(prefix)
    } catch {
      // Report the same confinement error for malformed and escaped paths.
    }
    if (!confined) this.issues.addIssue({ code: 'custom', path: at, message: `route must be inside ${prefix}` })
  }

  route = (path: string, at: (string | number)[]): void => this.confine(path, this.ownRoute, at)

  action = (value: PluginChromeAction, at: (string | number)[]): void => {
    if (value.verb === 'openPane' && !this.taskPanes.has(value.pane)) {
      this.issues.addIssue({ code: 'custom', path: [...at, 'pane'], message: `openPane names '${value.pane}', which this manifest does not declare as a task-scoped pane` })
    }
    if (value.verb === 'navigate' && !this.projectPanes.has(value.surface)) {
      this.issues.addIssue({ code: 'custom', path: [...at, 'surface'], message: `navigate names '${value.surface}', which this manifest does not declare as a project-scoped pane` })
    }
    if (value.verb === 'openOverlay') {
      if (this.overlays.has(value.overlay)) this.openedOverlays.add(value.overlay)
      else this.issues.addIssue({ code: 'custom', path: [...at, 'overlay'], message: `openOverlay names '${value.overlay}', which this manifest does not declare as an overlay surface` })
    }
    if (value.verb === 'surfaceAction' && !this.actionPanes.has(value.surface)) {
      this.issues.addIssue({
        code: 'custom', path: [...at, 'surface'],
        message: `surfaceAction names '${value.surface}', which this manifest does not declare as a pane drawing a region of its own`,
      })
    }
    if (value.verb === 'runNodeAction') this.route(value.path, [...at, 'path'])
    if (value.verb === 'openUrl' && !isPluginOpenableUrl(value.url)) {
      this.issues.addIssue({ code: 'custom', path: [...at, 'url'], message: 'openUrl must be https' })
    }
  }
}

export function validateContributionIds(refs: ManifestReferences): void {
  const { issues, manifest } = refs
  const {
    frames, sources, slots, commands, attention, nodeStats, contentLinks, agentContexts,
    refResolvers, routes, themes, contextMenus, extensionPoints, extensions, schedules,
    taskChecks, harnesses, agentTools, contextSections,
  } = manifest.contributions
  // The client uses ids for query keys and disposal across contribution registries.
  const seen = new Set<string>()
  for (const entry of [
    ...frames, ...sources, ...slots, ...commands, ...attention, ...nodeStats, ...contentLinks,
    ...agentContexts, ...refResolvers, ...routes, ...themes, ...contextMenus, ...extensionPoints,
    ...extensions, ...schedules, ...taskChecks, ...harnesses, ...agentTools, ...contextSections,
  ]) {
    if (seen.has(entry.id)) issues.addIssue({ code: 'custom', path: ['contributions'], message: `duplicate contribution id '${entry.id}'` })
    seen.add(entry.id)
  }
}
