import type { Component } from 'solid-js'
import { Registry } from './registry'

// A plugin surface that lives at project scope: drawn beside its own rail Source's list, addressed by
// a URL, and never inside a task's layout. docs/panes.md § Pane scope covers why this needed its own
// registry rather than a `scope` field on `PaneContribution`, and why its selection lives in the URL
// rather than in persisted layout state.

export type ProjectSurfaceContribution = {
  // The frame surface id, as the manifest declared it. Un-namespaced like every contribution id, so a
  // duplicate is the expected failure and the caller reports it rather than the registry replacing.
  id: string
  // The Router pattern, host-minted from the plugin id (registries/corePaths.ts) and confined both
  // when the node parses the manifest and again on the device, because a roster row is bytes a node
  // sent.
  path: string
  // Which `:param` of `path` carries the selected item. The host does the matching and supplies the
  // value; this names which capture it lands in, and is the only part of the match a manifest
  // chooses.
  item: string
  order: number
  component: Component<{ projectId: string; item?: string }>
}

export const projectSurfaceRegistry = new Registry<ProjectSurfaceContribution>('project-surface')

// Sorted like source routes are, so a static path can be declared ahead of a parameter path that
// would otherwise swallow it. The shell maps this straight onto `<Route>` elements.
export const projectSurfaceRoutes = (): ProjectSurfaceContribution[] =>
  [...projectSurfaceRegistry.entries()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

/**
/**
 * The concrete URL for one item inside a project-scoped surface, or null when nothing on this device
 * registered that surface: a plugin not installed here, or a bundle this device declined.
 *
 * Substitution over the registered pattern, not over anything the caller passed: the pattern came
 * from the manifest through the confinement check, so there is no path here a plugin could have
 * smuggled in, and both values are encoded on the way through.
 */
export function projectSurfacePath(surface: string, projectId: string, item: string): string | null {
  const entry = projectSurfaceRegistry.get(surface)
  if (!entry) return null
  return entry.path
    .replace(':projectId', encodeURIComponent(projectId))
    .replace(`:${entry.item}`, encodeURIComponent(item))
}

/**
/**
 * The inverse, and it has to be explicit: Solid Router hands a matched param back exactly as it
 * appears in the URL, so the encoding `projectSurfacePath` applied comes off here rather than
 * reaching the frame as `%3A`. A rail row id is `<connection>:<identifier>` for at least one
 * first-party plugin, so this is a real round trip and not a theoretical one.
 *
 * A URL can be typed or pasted, so a broken escape is expected input. It means "nothing addressed",
 * never a throw into the shell.
 */
export function decodeProjectSurfaceItem(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined
  }
}
