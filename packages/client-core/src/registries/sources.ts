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
  component?: Component
  defaultPane?: string
  requiredCapability?: string
  // OPTIONAL as of Phase 3, when `github` became an ordinary source. Every other source is browsed through
  // PromoteToTaskModal, which reads this; github's browse creates a task inline from its PR list (seeding
  // provider links as it goes), so it has no registry-driven promotion and declaring an unused one would be
  // a required field satisfied by dead code. The modal is only ever opened for a source that has one.
  promotion?: SourcePromotion<Item>
}

export const sourceRegistry = new Registry<SourceContribution<any>>('source')
