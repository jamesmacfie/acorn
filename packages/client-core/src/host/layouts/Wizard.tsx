import { For, Show } from 'solid-js'
import { Button } from '../../kit/components/primitives'
// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/regions'
import type { LayoutProps } from './regions'

// `wizard`: one step region at a time, with the host drawing the indicator and the back and next
// controls from `steps` and `current`. One focus group.
//
// The plugin owns which step it is on and what happens when someone advances, because a wizard's
// branches are its own: onboarding's GitHub screen is a detour that shares a position with the screen
// after it. The host owns the chrome, which is the part every wizard drew twice.
//
// Narrow and terminal: unchanged.
export function Wizard(props: LayoutProps) {
  const steps = () => props.steps ?? []
  const at = () => steps().findIndex((step) => step.id === props.current)

  const step = (offset: number) => {
    const next = steps()[at() + offset]
    if (next) props.onStep?.(next.id)
  }

  return (
    <div class="pane layout-wizard">
      <ol class="layout-wizard-steps" aria-label={`${props.label} steps`}>
        <For each={steps()}>{(entry, index) => (
          <li
            class="layout-wizard-step"
            data-state={index() === at() ? 'current' : index() < at() ? 'done' : 'todo'}
            aria-current={index() === at() ? 'step' : undefined}
          >{entry.label}</li>
        )}</For>
      </ol>
      <div class="layout-wizard-body" use:regionFocus={{ paneId: props.stateKey, regionId: 'step' }}>{props.regions.step?.()}</div>
      <div class="layout-wizard-actions">
        <Show when={at() > 0}>
          <Button variant="bare" onPress={() => step(-1)}>Back</Button>
        </Show>
        <Show when={at() >= 0 && at() < steps().length - 1}>
          <Button tone="accent" disabled={props.canAdvance === false} onPress={() => step(1)}>Next</Button>
        </Show>
      </div>
    </div>
  )
}
