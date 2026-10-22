import { For } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { hasHostCapability } from '../../../infra/node/hostCapabilities'
import { formFactor } from '../../../infra/platform'
import { ContributionBoundary } from '../../../kit/components/content/ContributionBoundary'
import {
  isTaskSlot,
  uiSlotRegistry,
  type ShellSlotContribution,
  type TaskSlotId,
  type UiSlotContext,
  type UiSlotId,
} from './slots'

// The two slot hosts over the one registry. The registry and its contribution types live in
// ./slots.ts, JSX-free, so a caller that only registers never imports a component.

const ordered = (slot: UiSlotId) =>
  [...uiSlotRegistry.entries()]
    .filter((contribution) => contribution.slot === slot && hasHostCapability(contribution.requires))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

export function TaskSlotHost(props: { slot: TaskSlotId; taskId: string }) {
  const contributions = () => ordered(props.slot).filter(isTaskSlot)
  return (
    <For each={contributions()}>
      {(contribution) => (
        <ContributionBoundary contributionId={contribution.id} owner={uiSlotRegistry.ownerOf(contribution.id)} quiet>
          <Dynamic component={contribution.component} taskId={props.taskId} />
        </ContributionBoundary>
      )}
    </For>
  )
}

export function SlotHost(props: { slot: UiSlotId; context: UiSlotContext }) {
  const contributions = () =>
    ordered(props.slot)
      .filter((contribution): contribution is ShellSlotContribution => !isTaskSlot(contribution))
      .filter((contribution) => formFactor() !== 'narrow' || contribution.onPhone === true)
      .filter((contribution) => contribution.when?.(props.context) ?? true)
  return (
    <For each={contributions()}>
      {(contribution) => (
        // A stable root per contribution keeps lazy and conditional content out of the For's
        // shared insertion range. Detached empty-text placeholders can otherwise abort effects,
        // including the first-run modal's Portal mount.
        <div class="ui-slot-contribution">
          <ContributionBoundary
            contributionId={contribution.id}
            owner={uiSlotRegistry.ownerOf(contribution.id)}
            quiet={props.slot === 'topbar.right'}
          >
            <Dynamic component={contribution.component} context={props.context} />
          </ContributionBoundary>
        </div>
      )}
    </For>
  )
}
