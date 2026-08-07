// The two slot registries and their contribution types, split out of uiSlots.tsx.
//
// Nothing about them changed — uiSlots.tsx re-exports every name below, so every existing
// `@acorn/client-core/registries/uiSlots.tsx` import keeps working. The split exists because uiSlots.tsx
// contains JSX (the two host components), and this repo's vitest configs deliberately run in a bare Node
// environment with no Solid transform: a module that reaches a JSX file cannot be imported by a test at
// all. Keeping the registries JSX-free is what lets registries/plugin.ts — the plugin host, whose
// ownership, duplicate and idempotency rules are worth pinning — have a unit test.
import type { Component } from 'solid-js'
import type { ClientCapabilityRequirement } from '../capabilities'
import type { Task } from '../queries'
import { Registry } from './registry'

export type UiSlotId = 'topbar.left' | 'topbar.right' | 'task.switcher.extra' | 'overlay' | 'drawer'

export type UiSlotContext = {
  taskActive: boolean
  terminalOpen: boolean
  toggleTerminal: () => void
  // Idempotent close, separate from the toggle, because a toggle is not safe to call twice.
  //
  // The terminal drawer closes itself when its last tab is closed, and TerminalPanel.closeTab does that after
  // two awaits — so two closes racing both see an empty roster and both fire. With only `toggleTerminal`
  // available the second flipped the drawer back OPEN, where TerminalPanel's onMount auto-launches the rail's
  // default profile: a spurious PTY in a drawer the user had just closed. The shell already used the mirror
  // form of this guard for its own open affordance (`if (!termOpen()) toggleTerm()`), which is a hint that the
  // toggle was the wrong shape to publish alone.
  closeTerminal: () => void
  openSettings: (tab?: string) => void
  selectTask: (taskId: string) => void
  // The task the drawer belongs to, or null outside a task view. Added with the 'drawer' slot: a shell slot
  // gets the whole context (unlike a TaskSlot, which gets only a taskId), and the terminal drawer needs the
  // task's branch and worktree path, not just its id.
  activeTask: Task | null
}

export type UiSlotContribution = {
  id: string
  slot: UiSlotId
  order: number
  requires?: ClientCapabilityRequirement
  when?: (context: UiSlotContext) => boolean
  component: Component<{ context: UiSlotContext }>
}

export const uiSlotRegistry = new Registry<UiSlotContribution>('ui-slot')

// Task-scoped slots: lighter than UiSlotContext (components get just the taskId), so hosts like
// the worktree footer don't have to thread shell callbacks they don't own. Additive — plugins
// contribute badges (e.g. docker's running-container count) without a core import of the plugin.
export type TaskSlotId = 'task.footer' | 'tabrail.task-row'

export type TaskSlotContribution = {
  id: string
  slot: TaskSlotId
  order: number
  requires?: ClientCapabilityRequirement
  component: Component<{ taskId: string }>
}

export const taskSlotRegistry = new Registry<TaskSlotContribution>('task-slot')
