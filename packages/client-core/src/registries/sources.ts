import type { Component } from 'solid-js'
import type { Task, TaskSeed } from '@acorn/protocol/api.ts'
import { Registry } from './registry'

export type SourcePromotionContext = {
  projectId: string
  owner: string
  repo: string
  branch?: string
  existingBranches?: string[]
}

export type SourcePromotion<Item> = {
  canPromote(item: Item, context: SourcePromotionContext): boolean
  prepare(item: Item, context: SourcePromotionContext): TaskSeed | Promise<TaskSeed>
  create(seed: TaskSeed): Promise<Task>
  afterCreate?(task: Task, item: Item, context: SourcePromotionContext): Promise<void>
  attachToCurrentTask?(taskId: string, item: Item): Promise<void>
}

// A URL pattern a source wants registered on the Router. `order` decides registration order, so a
// static path can be declared ahead of a parameter path that would otherwise swallow it. This
// replaced a single-first-match `kind` lookup on the route registry (docs/frontend.md § Registries
// and plugins).
export type SourceRouteContribution = {
  id: string
  path: string
  order: number
}

export type SourceContribution<Item = unknown> = {
  id: string
  // The rail's position. Required rather than optional, and not derived from plugin activation order:
  // docs/frontend.md § Registries and plugins has the reason every client registry sorts on an
  // explicit order field instead.
  order: number
  // Absent for local sources with no integration row behind them (docker); always shown.
  providerId?: string
  glyph: string
  label: string
  // An extra gate beyond `providerId`, for a source whose relevance is not an integration question.
  // Core's Fleet home is the one user of it (docs/frontend.md § Registries and plugins).
  when?: () => boolean
  component?: Component
  defaultPane?: string
  requiredCapability?: string
  // The owning plugin may declare the initial browse surface (docs/frontend.md § Registries and
  // plugins), so the shell does not need to know which provider is bundled first.
  isDefault?: boolean
  routes?: readonly SourceRouteContribution[]
  // Where a task belongs in the router, when this source owns it. docs/plugins.md § Loaded plugins:
  // the client half and docs/frontend.md § Registries and plugins cover why this replaced a `kind`
  // lookup on the route registry.
  taskPath?: (task: Task) => string | undefined
  // The inverse of `taskPath`: does this task already track the thing a reference panel is showing?
  // docs/plugins.md § Loaded plugins: the client half explains why `task.links` alone is not enough.
  tracksRef?: (task: Task, ref: { providerId?: string; displayId: string }) => boolean
  promotion?: SourcePromotion<Item>
  // No `emptyState` here, unlike the descriptor twin (docs/plugins.md § Loaded plugins: the client
  // half): a first-party source is a component and already renders its own empty case.
}

export const sourceRegistry = new Registry<SourceContribution<any>>('source')

const sourceOrder = (a: SourceContribution, b: SourceContribution): number => a.order - b.order || a.id.localeCompare(b.id)

// Resolved lazily: plugins populate the registry after this module evaluates. docs/frontend.md §
// Registries and plugins covers the default/order fallback.
export const defaultSource = (): SourceContribution | undefined => {
  const sources = sourceRegistry.entries()
  return sources.find((source) => source.isDefault) ?? [...sources].sort(sourceOrder)[0]
}

export const defaultSourceId = (): string | undefined => defaultSource()?.id

export const sourceRouteContributions = (): SourceRouteContribution[] => sourceRegistry
  .entries()
  .flatMap((source) => source.routes ?? [])
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

// Which rail source owns a path, by the routes it declared.
//
// The shell draws from `selectedSource()`, not the location: every contributed route mounts as a
// `noop` component and App picks the surface off the rail. Navigating to a source's route while a
// different source is selected changes the address bar and nothing else, so a caller minting a path
// must already be inside the owning source.
//
// Segment-count and `:param` matching, not the router's grammar. Contributed patterns are plain
// `/p/:projectId/…` forms today; if one ever needs optional or splat segments, ask the router to match
// instead of growing this.
const matchesRoute = (pattern: string, path: string): boolean => {
  const expected = pattern.split('/').filter(Boolean)
  const actual = path.split('/').filter(Boolean)
  return expected.length === actual.length
    && expected.every((segment, index) => (segment.startsWith(':') ? !!actual[index] : segment === actual[index]))
}

export function sourceIdForPath(path: string): string | undefined {
  const clean = path.split(/[?#]/)[0]
  return sourceRegistry.entries().find((source) => source.routes?.some((route) => matchesRoute(route.path, clean)))?.id
}

// Ask every source whether it owns this task's URL. Registry order breaks a tie between two sources
// that both claim one.
export function taskPathFromSources(task: Task): string | undefined {
  for (const source of sourceRegistry.entries()) {
    const path = source.taskPath?.(task)
    if (path) return path
  }
  return undefined
}

/** Does this task already track this external reference? Host link matching first, then each
 *  source's own second spelling (docs/plugins.md § Loaded plugins: the client half). */
export function taskTracksRef(task: Task, ref: { providerId?: string; displayId: string; connectionId?: string }): boolean {
  // A link names a connection and a panel target usually does not: a PR body says `ENG-42`, not which
  // connected Linear owns it. The connection is compared only when both sides have one, the same
  // looseness every identifier match here accepts.
  const linked = task.links.some((link) =>
    link.providerId === ref.providerId
    && link.identifier === ref.displayId
    && (!ref.connectionId || link.connectionId === ref.connectionId))
  return linked || sourceRegistry.entries().some((source) => source.tracksRef?.(task, ref) === true)
}
