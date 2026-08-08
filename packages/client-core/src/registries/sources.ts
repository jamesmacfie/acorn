import type { Component } from 'solid-js'
import type { Task, TaskSeed } from '@acorn/protocol/api.ts'
import { Registry } from './registry'

export type SourcePromotionContext = {
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

export type SourceReadContext = { signal?: AbortSignal }
export type SourceRepo = {
  id: number
  owner: string
  name: string
  private: boolean
  pushedAt: number | null
}
export type SourceCheck = { name: string; status: string | null; url: string | null; runId: number | null }
export type SourcePullChecks = { checks: SourceCheck[] }

// Repository-backed sources provide the shell's shared repo picker reads through this narrow seam.
// The source owns the routes and wire types; core owns only the generic query/cache behavior.
export type SourceRepository = {
  repos(context: SourceReadContext): Promise<SourceRepo[]>
  pins(context: SourceReadContext): Promise<number[]>
  refreshRepos(): Promise<void>
  setPin(repoId: number, pinned: boolean): Promise<void>
  pullChecks(owner: string, repo: string, number: string, context: SourceReadContext): Promise<SourcePullChecks>
}

export type SourceRouteKind = 'repo' | 'create' | 'detail'
export type SourceRouteContribution = {
  id: string
  path: string
  kind: SourceRouteKind
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
  repository?: SourceRepository
  routes?: readonly SourceRouteContribution[]
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

export const repositorySource = (): SourceRepository | undefined => sourceRegistry.entries().find((source) => source.repository)?.repository

export const sourceRouteContributions = (): SourceRouteContribution[] => sourceRegistry
  .entries()
  .flatMap((source) => source.routes ?? [])
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

export const sourceRoutePath = (kind: SourceRouteKind): string | undefined => sourceRouteContributions().find((route) => route.kind === kind)?.path

export const sourcePath = (kind: SourceRouteKind, params: Record<string, string | number>): string => {
  const path = sourceRoutePath(kind)
  if (!path) return '/'
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => encodeURIComponent(String(params[name] ?? '')))
}
