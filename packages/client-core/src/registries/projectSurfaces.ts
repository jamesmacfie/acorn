import type { Component } from 'solid-js'
import { Registry } from './registry'

// A plugin surface that lives at PROJECT scope: drawn beside its own rail Source's list, addressed by a
// URL, and never inside a task's layout (docs/plugins.md, docs/panes.md § Pane scope).
//
// This is the carrier for the one thing the descriptor tier could not express. `frames` targets are all
// either task-scoped or modal, so a manifest that wanted an issue view beside its rail list had no way to
// ask for one — the rail row's `openPane` was refused outside a task, and the surface a compiled plugin
// used to reach with a `SourceRouteContribution` had no manifest form at all.
//
// Why its own registry rather than a `scope` field on PaneContribution: a pane contribution's component
// takes a `Task`, its id is a persisted layout key, and its consumers are the task pane switcher and the
// layout reducer. None of that is true here — there is no task to hand over, nothing to persist, and
// exactly one consumer (plugins/chrome/ChromeSourcePanel.tsx). One registry would mean every one of those
// consumers branching on a scope it cannot act on, to be told to skip the entry.
//
// The entry carries its ADDRESS alongside its component, because those are the same decision. A task pane
// keeps its selection in the task's persisted layout state; a project-scoped surface has no such store, so
// the URL is where its selection lives — which makes the route and the thing it addresses one contribution
// rather than two that have to be kept in agreement.

export type ProjectSurfaceContribution = {
  // The frame surface id, as the manifest declared it. Un-namespaced like every contribution id, so a
  // duplicate is the expected failure and the caller reports it rather than the registry replacing.
  id: string
  // The Router pattern. HOST-MINTED from the plugin id (registries/corePaths.ts) and confined both when
  // the node parses the manifest and again on the device, because a roster row is bytes a node sent.
  path: string
  // Which `:param` of `path` carries the selected item. The host does the matching and supplies the
  // value; this names which capture it lands in, and is the only part of the match a manifest chooses.
  item: string
  order: number
  component: Component<{ projectId: string; item?: string }>
}

export const projectSurfaceRegistry = new Registry<ProjectSurfaceContribution>('project-surface')

// Sorted like source routes are, so a static path can be declared ahead of a parameter path that would
// otherwise swallow it. The shell maps this straight onto `<Route>` elements.
export const projectSurfaceRoutes = (): ProjectSurfaceContribution[] =>
  [...projectSurfaceRegistry.entries()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

/**
 * The concrete URL for one item inside a project-scoped surface, or null when nothing on this device
 * registered that surface — a plugin not installed here, or a bundle this device declined.
 *
 * Substitution over the REGISTERED pattern, not over anything the caller passed: the pattern came from the
 * manifest through the confinement check, so there is no path here a plugin could have smuggled in, and
 * both values are encoded on the way through.
 */
export function projectSurfacePath(surface: string, projectId: string, item: string): string | null {
  const entry = projectSurfaceRegistry.get(surface)
  if (!entry) return null
  return entry.path
    .replace(':projectId', encodeURIComponent(projectId))
    .replace(`:${entry.item}`, encodeURIComponent(item))
}

/**
 * The inverse, and it has to be explicit: Solid Router hands a matched param back exactly as it appears in
 * the URL, so the encoding `projectSurfacePath` applied comes off here rather than reaching the frame as
 * `%3A`. A rail row id is `<connection>:<identifier>` for at least one first-party plugin, so this is a
 * real round trip and not a theoretical one.
 *
 * A URL can be typed or pasted, so a broken escape is expected input. It means "nothing addressed", never a
 * throw into the shell.
 */
export function decodeProjectSurfaceItem(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined
  }
}
