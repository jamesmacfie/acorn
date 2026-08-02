import { For } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { Component } from 'solid-js'
import { hasClientCapability, type ClientCapabilityRequirement } from '../capabilities'
import { ContributionBoundary } from '../ui/ContributionBoundary'
import { Registry } from './registry'

export type UiSlotId = 'topbar.left' | 'topbar.right' | 'task.switcher.extra' | 'overlay'

export type UiSlotContext = {
  taskActive: boolean
  terminalOpen: boolean
  toggleTerminal: () => void
  openSettings: (tab?: string) => void
  selectTask: (taskId: string) => void
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

export function TaskSlotHost(props: { slot: TaskSlotId; taskId: string }) {
  const contributions = () => [...taskSlotRegistry.entries()]
    .filter((contribution) => contribution.slot === props.slot && hasClientCapability(contribution.requires))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return (
    <For each={contributions()}>
      {(contribution) => (
        <ContributionBoundary contributionId={contribution.id} quiet>
          <Dynamic component={contribution.component} taskId={props.taskId} />
        </ContributionBoundary>
      )}
    </For>
  )
}

export function SlotHost(props: { slot: UiSlotId; context: UiSlotContext }) {
  const contributions = () => [...uiSlotRegistry.entries()]
    .filter((contribution) => contribution.slot === props.slot && hasClientCapability(contribution.requires) && (contribution.when?.(props.context) ?? true))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return (
    <For each={contributions()}>
      {(contribution) => (
        <ContributionBoundary contributionId={contribution.id} quiet={props.slot === 'topbar.right'}>
          <Dynamic component={contribution.component} context={props.context} />
        </ContributionBoundary>
      )}
    </For>
  )
}
