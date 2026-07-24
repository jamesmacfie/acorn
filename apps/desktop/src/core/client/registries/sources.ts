import type { Component } from 'solid-js'
import type { Task, TaskSeed } from '../../shared/api'
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
  // Absent for local sources (no integration row backs them, e.g. docker) — they are always shown.
  providerId?: string
  glyph: string
  label: string
  component?: Component
  defaultPane?: string
  requiredCapability?: string
  promotion: SourcePromotion<Item>
}

export const sourceRegistry = new Registry<SourceContribution<any>>('source')
