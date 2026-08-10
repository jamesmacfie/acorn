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
  promotion?: SourcePromotion<Item>
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

// Ask every source whether it owns this task's URL. Registry order decides a tie, so two sources that both
// claim a task resolve deterministically rather than by whichever plugin loaded first.
export function taskPathFromSources(task: Task): string | undefined {
  for (const source of sourceRegistry.entries()) {
    const path = source.taskPath?.(task)
    if (path) return path
  }
  return undefined
}
