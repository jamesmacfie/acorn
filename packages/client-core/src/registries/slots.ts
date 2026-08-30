// The slot registry and its contribution types, split out of uiSlots.tsx, which re-exports every name
// below so existing imports keep working. This module holds no JSX import
// (docs/frontend.md § Registries and plugins), which is what lets registries/plugin.ts have a unit
// test.
import type { Component } from 'solid-js'
import type { HostCapabilityRequirement } from '../infra/node/hostCapabilities'
import type { Task } from '../infra/queries'
import { Registry } from './registry'

export type TaskSlotId = 'task.footer'
const TASK_SLOT_IDS: readonly TaskSlotId[] = ['task.footer']

export type UiSlotId = 'topbar.left' | 'topbar.right' | 'task.switcher.extra' | 'overlay' | 'drawer' | TaskSlotId

export type UiSlotContext = {
  taskActive: boolean
  terminalOpen: boolean
  toggleTerminal: () => void
  // Idempotent close, separate from the toggle, because a toggle isn't safe to call twice.
  //
  // The terminal drawer closes itself when its last tab is closed, and TerminalPanel.closeTab does that
  // after two awaits, so two closes racing both see an empty roster and both fire. With only
  // `toggleTerminal` available the second flipped the drawer back open, where TerminalPanel's onMount
  // auto-launches the rail's default profile: a spurious PTY in a drawer the user had just closed.
  closeTerminal: () => void
  openSettings: (tab?: string) => void
  selectTask: (taskId: string) => void
  // The task the drawer belongs to, or null outside a task view. A shell slot gets the whole context,
  // unlike a TaskSlot which gets only a taskId, and the terminal drawer needs the task's branch and
  // worktree path.
  activeTask: Task | null
}

// One slot registry. The id picks the context the component gets: a shell slot receives the whole
// UiSlotContext, a task slot receives just the task it is drawn in. They were two registries with two
// id types until 2026-08-27, which cost a context member, a `Registry` and a line in every document
// listing contribution kinds, to express one difference (docs/reviews § Plugin surface consistency).
type SlotBase = {
  id: string
  order: number
  requires?: HostCapabilityRequirement
}

export type ShellSlotContribution = SlotBase & {
  slot: Exclude<UiSlotId, TaskSlotId>
  when?: (context: UiSlotContext) => boolean
  component: Component<{ context: UiSlotContext }>
}

// Task-scoped slots, lighter than UiSlotContext: components get just the taskId, so hosts like the
// worktree footer don't have to thread shell callbacks they don't own. Additive, so plugins contribute
// badges without a core import of the plugin.
// `tabrail.task-row` used to be here. It was the escape hatch that let a plugin draw arbitrary JSX
// and position it in the rail's own pixel geography; markers replaced it (registries/railMarkers.ts).
export type TaskSlotContribution = SlotBase & {
  slot: TaskSlotId
  component: Component<{ taskId: string }>
}

export type UiSlotContribution = ShellSlotContribution | TaskSlotContribution

export const uiSlotRegistry = new Registry<UiSlotContribution>('ui-slot')

export const isTaskSlot = (contribution: UiSlotContribution): contribution is TaskSlotContribution =>
  TASK_SLOT_IDS.includes(contribution.slot as TaskSlotId)
