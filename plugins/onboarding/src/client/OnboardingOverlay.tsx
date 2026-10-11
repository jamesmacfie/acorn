import { createEffect, createSignal, lazy, onCleanup, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import {
  activeNodeId,
  nodeReady,
  ownOnboardingVisibility,
  PrefKeys,
  prefsOptions,
  projectsOptions,
  WORKSPACES_PREF_KEY,
} from '@acorn/plugin-api/client'
import { onboardingVisible, shouldShowOnboarding } from './gate'

const OnboardingWizard = lazy(() => import('./OnboardingWizard'))

// Module scope, not inside the component. This contribution renders through the overlay slot host,
// inside the shell's `<Show when={nodeReady() && !isRestoring()}>`, a subtree the shell unmounts
// whenever the node connection drops. A signal in the component would be disposed by a brief node blip,
// "dismissed" would revert to false, and the first-run wizard would reappear over the work of someone
// who had already closed it.
//
// `opened` is module-scoped for the same reason, and is the latch described in gate.ts: the wizard
// creates a project, which is exactly the condition that opened it, so the trigger must not double as
// the reason to stay open.
const [dismissed, setDismissed] = createSignal(false)
const [opened, setOpened] = createSignal(false)

export default function OnboardingOverlay() {
  const visibility = ownOnboardingVisibility()
  onCleanup(visibility.dispose)
  const prefs = createQuery(() => prefsOptions(nodeReady()))
  const projects = createQuery(() => projectsOptions(nodeReady()))
  const gate = () => ({
    dismissed: dismissed(),
    nodeReady: nodeReady(),
    prefsLoaded: prefs.data !== undefined,
    onboarded: prefs.data?.[PrefKeys.onboarded],
    projectCount: projects.data?.length,
  })

  // A wizard opened on one Node must not stay open when the window changes Nodes.
  let currentNode = activeNodeId()
  createEffect(() => {
    const nextNode = activeNodeId()
    if (nextNode !== currentNode) {
      currentNode = nextNode
      setOpened(false)
      setDismissed(false)
    }
    if (shouldShowOnboarding(gate())) setOpened(true)
  })
  createEffect(() => visibility.update(onboardingVisible({ ...gate(), open: opened() })))

  return (
    <Show when={onboardingVisible({ ...gate(), open: opened() })}>
      <OnboardingWizard
        workspacesPreference={prefs.data?.[WORKSPACES_PREF_KEY]}
        onClose={() => {
          setOpened(false)
          setDismissed(true)
        }}
      />
    </Show>
  )
}
