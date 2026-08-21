import { For } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { hasClientCapability } from '../capabilities'
import { ContributionBoundary } from '../ui/ContributionBoundary'
import { taskSlotRegistry, uiSlotRegistry, type TaskSlotId, type UiSlotContext, type UiSlotId } from './slots'

// The two slot hosts. The registries and their contribution types live in ./slots.ts, JSX-free, and
// are re-exported here so `registries/uiSlots.tsx` stays the one import path callers already use.
export {
  taskSlotRegistry,
  uiSlotRegistry,
} from './slots'
export type {
  TaskSlotContribution,
  TaskSlotId,
  UiSlotContext,
  UiSlotContribution,
  UiSlotId,
} from './slots'

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
