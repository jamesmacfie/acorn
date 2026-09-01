import type { Component } from 'solid-js'
import type { Task, TaskSeed } from '@acorn/protocol/api.ts'
import type { ProviderCapabilityName } from '@acorn/protocol/integrations.ts'
import type { HostCapabilityRequirement } from '../../../infra/node/hostCapabilities'
import { Registry } from '../../../kit/lib/registry'

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
// static path can be declared ahead of a parameter path that would swallow it (docs/frontend.md §
// Registries and plugins).
export type SourceRouteContribution = {
  id: string
  path: string
  order: number
}

export type SourceContribution<Item = unknown> = {
  id: string
  // The rail's position. Required rather than derived from plugin activation order. See
  // docs/frontend.md § Registries and plugins.
  order: number
  // Absent for local sources with no integration row behind them (docker); always shown.
  providerId?: string
  glyph: string
  label: string
  // The platform question, the same field every host-filtered contribution takes: does this renderer
  // have a desktop shell, does this node run terminals (../hostCapabilities.ts).
  requires?: HostCapabilityRequirement
  // An extra gate beyond `providerId`, for a source whose relevance is not an integration question.
  // Core's Fleet home is the one user of it (docs/frontend.md § Registries and plugins).
  when?: () => boolean
  component?: Component
  /**
   * The surface as a list beside a detail, for a host that draws the two halves in different places.
   *
   * A source has always been one opaque component, and on the desktop that is fine: it draws its own
   * `ListDetail` and the shell hands it the whole width. A terminal shell puts the list in a panel of
   * its own down the left and the detail in the main panel, and it cannot reach inside a component to
   * separate them — the `split` form of `ListDetail` takes both columns as `children`, so even the
   * kit node does not know which of its children is which.
   *
   * So a source says it, in the same shape a pane already declares: `list-detail` with a `list` and a
   * `detail` (@acorn/protocol/paneLayouts.ts). Both hosts read the same field and each draws it where
   * it draws such things; the desktop's rendering is the `ListDetail` the source used to write by
   * hand (./SourceSurface.tsx).
   *
   * Optional, and a source without it keeps every previous behaviour: `component` fills the surface
   * and a terminal's list panel stays empty.
   */
  regions?: { list: Component; detail: Component }
  // The task origins this source creates, as origin id → Lucide glyph (features/tasks/origin.ts). A
  // source whose origin is its own id needs nothing here; github's rail is `github` and the tasks it
  // makes carry `github-pr`, so it says so.
  origins?: Readonly<Record<string, string>>
  // The pane a task this source tracks opens on the first time it is activated. A task no source
  // claims falls to the layout reducer's default (features/tasks/taskLayout.ts).
  defaultPane?: string
  // A third question again: given the integration behind `providerId` is connected, does it grant this
  // capability? Not `requires`, which asks about the platform, and not a plugin-to-plugin capability
  // either — the three used to share a word (docs/plugins.md § Collaboration rules).
  requiresProvider?: ProviderCapabilityName
  // Does this surface read the routed project? Opt in, because most sources don't, and a source that
  // never said it was project-aware almost certainly isn't. The shell shows the project picker only
  // for sources that declare it, so Home no longer offers a control that changes nothing there.
  projectScoped?: boolean
  // The owning plugin may declare the initial browse surface (docs/frontend.md § Registries and
  // plugins), so the shell does not need to know which provider is bundled first.
  isDefault?: boolean
  routes?: readonly SourceRouteContribution[]
  // Where a task belongs in the router, when this source owns it. See docs/plugins.md § Loaded
  // plugins: the client half.
  taskPath?: (task: Task) => string | undefined
  // The inverse of `taskPath`: does this task already track the thing a reference panel is showing?
  // docs/plugins.md § Loaded plugins: the client half explains why `task.links` alone is not enough.
  tracksRef?: (task: Task, ref: { providerId?: string; displayId: string }) => boolean
  promotion?: SourcePromotion<Item>
  // No `emptyState` here, unlike the descriptor twin, because a first-party source is a component and
  // renders its own empty case (docs/plugins.md § Loaded plugins: the client half).
}

export const sourceRegistry = new Registry<SourceContribution<any>>('source')

const sourceOrder = (a: SourceContribution, b: SourceContribution): number => a.order - b.order || a.id.localeCompare(b.id)

/** Does the source currently on screen read the routed project? Every affordance that changes the
 *  project asks this one question, so the topbar picker and a command that does the same job can
 *  never disagree about where choosing a project means something. */
export const sourceIsProjectScoped = (sourceId: string | null | undefined): boolean =>
  !!sourceRegistry.get(sourceId ?? '')?.projectScoped

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
// The shell draws from `selectedSource()`, not the location. Every contributed route mounts as a
// `noop` component and App picks the surface off the rail, so navigating to a source's route while
// another source is selected changes the address bar and nothing else.
//
/**
 * The parameters a pattern pulls out of a path, or `null` where it does not match.
 *
 * Segment-count and `:param` matching, not the router's grammar. Every contributed pattern is a plain
 * `/p/:projectId/…` form. If one needs optional or splat segments, ask the router to match instead.
 *
 * Exported because the terminal has no router and matches with this instead: `apps/tui/src/kit/router.ts`
 * resolves `useParams` against the same patterns the desktop's Router is built from, so the two hosts
 * cannot disagree about what a path means (docs/tui.md § The router).
 */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split('/').filter(Boolean)
  const actual = path.split(/[?#]/)[0].split('/').filter(Boolean)
  if (expected.length !== actual.length) return null
  const params: Record<string, string> = {}
  for (const [index, segment] of expected.entries()) {
    if (!segment.startsWith(':')) {
      if (segment !== actual[index]) return null
      continue
    }
    if (!actual[index]) return null
    params[segment.slice(1)] = decodeURIComponent(actual[index])
  }
  return params
}

export function sourceIdForPath(path: string): string | undefined {
  const clean = path.split(/[?#]/)[0]
  return sourceRegistry.entries().find((source) => source.routes?.some((route) => matchRoute(route.path, clean)))?.id
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

/** Which pane a task opens on the first time it is activated, asked of the source that tracks it.
 *
 *  Two questions in precedence order, the same two `taskTracksRef` asks. A source that owns the
 *  task's URL has the strongest claim, which is how a PR-backed task lands on the pull request
 *  rather than on a ticket linked from its body; failing that, a link's provider claims it. Nobody
 *  answering is a real answer: the caller leaves the layout alone and the reducer's default stands. */
export function defaultPaneForTask(task: Task): string | undefined {
  const claiming = sourceRegistry.entries().filter((source) => source.defaultPane)
  const byPath = claiming.find((source) => source.taskPath?.(task))
  if (byPath) return byPath.defaultPane
  for (const link of task.links) {
    const source = claiming.find((candidate) => candidate.providerId === link.providerId)
    if (source) return source.defaultPane
  }
  return undefined
}

/** Does this task already track this external reference? Host link matching first, then each
 *  source's own second spelling (docs/plugins.md § Loaded plugins: the client half). */
export function taskTracksRef(task: Task, ref: { providerId?: string; displayId: string; connectionId?: string }): boolean {
  // A link names a connection and a panel target usually does not. A PR body says `ENG-42`, not which
  // connected Linear owns it, so the connection is compared only when both sides have one.
  const linked = task.links.some((link) =>
    link.providerId === ref.providerId
    && link.identifier === ref.displayId
    && (!ref.connectionId || link.connectionId === ref.connectionId))
  return linked || sourceRegistry.entries().some((source) => source.tracksRef?.(task, ref) === true)
}
