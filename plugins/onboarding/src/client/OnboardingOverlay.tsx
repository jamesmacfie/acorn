import { createEffect, createSignal, lazy, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { nodeReady, PrefKeys, prefsOptions, projectsOptions } from '@acorn/plugin-api/client'
import { onboardingVisible, shouldShowOnboarding } from './gate'

const OnboardingWizard = lazy(() => import('./OnboardingWizard'))

// Module scope, not inside the component, and that's the difference between this and the shell's
// original.
//
// App.tsx held the signal above its `<Show when={nodeReady() && !isRestoring()}>`. This contribution
// renders through the overlay slot host, which is inside that Show, so moving the signal into the
// component put it in a subtree the shell unmounts whenever the node connection drops. A brief node blip
// disposed the signal, "dismissed" reverted to false, and the first-run wizard reappeared over the work
// of someone who had already closed it.
//
// `opened` is module-scoped for the same reason, and is the latch described in gate.ts: the wizard
// creates a project, which is exactly the condition that opened it, so the trigger must not double as
// the reason to stay open.
const [dismissed, setDismissed] = createSignal(false)
const [opened, setOpened] = createSignal(false)

export default function OnboardingOverlay() {
  const prefs = createQuery(() => prefsOptions(nodeReady()))
  const projects = createQuery(() => projectsOptions(nodeReady()))
  const gate = () => ({
    dismissed: dismissed(),
    nodeReady: nodeReady(),
    prefsLoaded: prefs.data !== undefined,
    onboarded: prefs.data?.[PrefKeys.onboarded],
    projectCount: projects.data?.length,
  })

  createEffect(() => {
    if (shouldShowOnboarding(gate())) setOpened(true)
  })

  return (
    <Show when={onboardingVisible({ ...gate(), open: opened() })}>
      <OnboardingWizard
        onClose={() => {
          setOpened(false)
          setDismissed(true)
        }}
      />
    </Show>
  )
}
