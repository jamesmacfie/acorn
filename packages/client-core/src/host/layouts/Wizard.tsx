import { createEffect, For, on, onCleanup, onMount, Show } from 'solid-js'
import { Button } from '../../kit/components/primitives'
// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/focusRegions'
import type { LayoutProps } from './regions'

// `wizard`: one step region at a time, with the host drawing the indicator and the back and next
// controls from `steps` and `current`. One focus group.
//
// The plugin owns which step it is on and what happens when someone advances, because a wizard's
// branches are its own: onboarding's GitHub screen is a detour that shares a position with the screen
// after it. The host owns the chrome, which is the part every wizard drew twice.
//
// The footer holds every action, so a step's body is content only: skip at the start, then Back and
// Next at the end, and the finish action in Next's place on the last step. It has the modal
// footer's padding and divider.
//
// The body takes focus on open and on every step change, so a screen reader reads the new step.
// It also takes it back whenever a change inside it drops focus to the page, because the button
// pressed there has just unmounted. Before this a keyboard user started again from the top. The
// second watch covers a detour that shares its step's place, such as onboarding's GitHub screen.
//
// Narrow and terminal: unchanged.
export function Wizard(props: LayoutProps) {
  const steps = () => props.steps ?? []
  const at = () => steps().findIndex((step) => step.id === props.current)
  const last = () => at() === steps().length - 1
  let body: HTMLDivElement | undefined
  const reclaim = () => {
    const active = document.activeElement
    if (!active || active === document.body) body?.focus({ preventScroll: true })
  }
  createEffect(on(() => props.current, () => body?.focus({ preventScroll: true }), { defer: true }))
  onMount(() => {
    body?.focus({ preventScroll: true })
    const watch = new MutationObserver(reclaim)
    if (body) watch.observe(body, { childList: true, subtree: true })
    onCleanup(() => watch.disconnect())
  })

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
      <div
        ref={body}
        class="layout-wizard-body"
        tabindex="-1"
        use:regionFocus={{ paneId: props.stateKey, regionId: 'step' }}
      >{props.regions.step?.()}</div>
      <div class="layout-wizard-actions">
        <Show when={props.onSkip && !last()}>
          <Button variant="ghost" tip={props.skipTip} onPress={() => props.onSkip?.()}>{props.skipLabel ?? 'Skip'}</Button>
        </Show>
        <span class="layout-wizard-spacer" />
        <Show when={at() > 0}>
          <Button variant="ghost" onPress={() => step(-1)}>Back</Button>
        </Show>
        <Show when={at() >= 0 && !last()}>
          <Button variant="solid" tone="accent" disabled={props.canAdvance === false} onPress={() => step(1)}>
            {props.nextLabel ?? 'Next'}
          </Button>
        </Show>
        <Show when={last() && props.onFinish}>
          <Button variant="solid" tone="accent" disabled={props.canAdvance === false} onPress={() => props.onFinish?.()}>
            {props.finishLabel ?? 'Finish'}
          </Button>
        </Show>
      </div>
    </div>
  )
}
