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

// A URL pattern a source wants registered on the Router. `order` decides registration order, so a static
// path can be declared ahead of a parameter path that would otherwise swallow it.
//
// There is deliberately no `kind` here any more. It existed so a caller could ask for "the detail route"
// and get a path back, but the lookup scanned EVERY source and took the first match — which meant core's
// `pathForTask` was resolving GitHub's PR route by accident, and the second plugin to register a route of
// the same kind would have silently taken it over. Core's own paths are constants now (./corePaths.ts),
// and the one thing core needs from a plugin — where a task lives — is asked for explicitly via
// `taskPath` below.
export type SourceRouteContribution = {
  id: string
  path: string
  order: number
}

export type SourceContribution<Item = unknown> = {
  id: string
  // The rail's position, DECLARED rather than derived from where the plugin sits in the client plugin list.
  //
  // Required, not optional. Source order was the one place client plugin declaration order was observable, and
  // it was observable in the worst way: nothing in the code said so except a comment, and the only check was
  // e2e S1 — which could not see a reorder at all, because `availableSources` filters out provider-gated
  // sources with no connected integration and the e2e fixture connects none. Linear and Rollbar are github's two
  // immediate neighbours in the list, so they were invisible to the assertion and moving them changed nothing
  // it could observe.
  //
  // This is the same move the node side already makes with `SECTION_ORDER`, and for the same stated reason:
  // sorting on registration would make the plugin list's order load-bearing, which both hosts refuse to do
  // everywhere else (panes, settings pages, slots and palette rows all sort on `order`). It also lets
  // apps/desktop/src/app/client/plugins.ts stop claiming its first six entries are order-sensitive.
  order: number
  // Absent for local sources (no integration row backs them, e.g. docker) — they are always shown.
  providerId?: string
  glyph: string
  label: string
  // An extra gate beyond `providerId`, for a source whose relevance is not an integration question.
  //
  // One contributor: core's Fleet home, which must not exist with a single node — docs/ui-design.md § New surfaces
  // says "with only the bundled local node, this view stays out of the way; first-run never mentions
  // nodes at all". Expressing that as a `providerId` would be a lie (no integration backs it), and having
  // the component render an empty state would still leave a rail button asking about a concept the owner
  // has not met.
  when?: () => boolean
  component?: Component
  defaultPane?: string
  requiredCapability?: string
  // The owning plugin may declare the initial browse surface. Keeping this on the contribution avoids
  // making the shell know which provider happens to be bundled first.
  isDefault?: boolean
  routes?: readonly SourceRouteContribution[]
  // Where a task belongs in the router, when this source owns it — a PR-backed task lives at GitHub's PR
  // URL, not at the generic task path. Returning undefined means "not mine"; the first source to claim a
  // task wins and core falls back to `/t/:taskId`.
  //
  // This replaces core reaching into the route registry for `kind: 'detail'`. The knowledge that a task
  // with a pull number belongs at a PR URL is GitHub's, and it now lives in GitHub.
  taskPath?: (task: Task) => string | undefined
  // The INVERSE of `taskPath`, and the same knowledge read the other way: does this task already track
  // the thing a reference panel is showing?
  //
  // It exists because `task.links` is not the only way a task can be attached to an external item, and
  // assuming it was is a bug that shipped. A github-pr task records its pull request as `pullNumber` on
  // the task row — its `links` hold the LINEAR tickets found in the PR body — so a link-only check finds
  // nothing for a PR and offers to create a task that already exists. Only the owning source knows the
  // other spelling, which is exactly the argument `taskPath` already makes one field up.
  //
  // Host-owned link matching still runs first and covers every provider that seeds links, so a source
  // only implements this when it has a second way of recording the same relationship.
  tracksRef?: (task: Task, ref: { providerId?: string; displayId: string }) => boolean
  promotion?: SourcePromotion<Item>
  // There is deliberately NO `emptyState` here, unlike the descriptor twin (@acorn/protocol/api.ts §
  // PluginSourceEmptyState). A descriptor source has no component of its own — the host draws its list
  // and therefore owes it the empty case — whereas a first-party source IS a component and already
  // renders whatever it wants when it has nothing. A field here would be one every first-party source
  // carries and none reads, which is worse than its absence: it reads as a contract and is not one.
}

export const sourceRegistry = new Registry<SourceContribution<any>>('source')

const sourceOrder = (a: SourceContribution, b: SourceContribution): number => a.order - b.order || a.id.localeCompare(b.id)

// Resolve lazily because plugins populate the registry after this module is evaluated. The explicit
// default wins over rail order; the fallback keeps bare hosts useful before a provider declares one.
export const defaultSource = (): SourceContribution | undefined => {
  const sources = sourceRegistry.entries()
  return sources.find((source) => source.isDefault) ?? [...sources].sort(sourceOrder)[0]
}

export const defaultSourceId = (): string | undefined => defaultSource()?.id

export const sourceRouteContributions = (): SourceRouteContribution[] => sourceRegistry
  .entries()
  .flatMap((source) => source.routes ?? [])
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

// Which rail source OWNS a path, by the routes it declared.
//
// The shell draws from `selectedSource()`, not from the location — every contributed route is mounted as
// a `noop` component and App picks the surface off the rail (apps/desktop § the source Switch). So
// navigating to a source's route while a DIFFERENT source is selected changes the address bar and
// nothing else, which is a click that appears to do nothing. Every existing caller happened to already
// be inside the owning source — github's PR list navigating to its own detail — so the gap only showed
// once something outside a source started minting these paths (a dashboard row's in-app link).
//
// ponytail: segment-count + `:param` matching, not the router's grammar. Contributed patterns are plain
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

// Ask every source whether it owns this task's URL. Registry order decides a tie, so two sources that both
// claim a task resolve deterministically rather than by whichever plugin loaded first.
export function taskPathFromSources(task: Task): string | undefined {
  for (const source of sourceRegistry.entries()) {
    const path = source.taskPath?.(task)
    if (path) return path
  }
  return undefined
}

/** Does this task already track this external reference? Host-owned link matching first — it is
 *  provider-agnostic and covers everything that seeds `links` — then each source's own second spelling. */
export function taskTracksRef(task: Task, ref: { providerId?: string; displayId: string; connectionId?: string }): boolean {
  // A link names a connection and a panel target usually does not: a PR body says `ENG-42`, not which of
  // several connected Linears owns it. So the connection is compared only when BOTH sides have one, which
  // is the same looseness every other identifier match in this area accepts — and the same reason two
  // connected workspaces sharing a team prefix stays a known ambiguity rather than a solved one.
  const linked = task.links.some((link) =>
    link.providerId === ref.providerId
    && link.identifier === ref.displayId
    && (!ref.connectionId || link.connectionId === ref.connectionId))
  return linked || sourceRegistry.entries().some((source) => source.tracksRef?.(task, ref) === true)
}
