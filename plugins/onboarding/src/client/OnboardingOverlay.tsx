// The first-run gate, moved out of the shell (docs/vNext/plan.md § Phase 3, item 1).
//
// App.tsx used to own all of this: a lazy reference to this plugin's modal, an
// `onboardingDismissed` signal, and a five-clause `<Show when={…}>` reading two of its own queries. That
// made the shell responsible for knowing WHEN this plugin's modal should appear — which is why onboarding
// had no ClientPlugin at all: it had client code and nothing registrable.
//
// The gate lives here now because every input is client-core's, not the shell's: `nodeReady`, the prefs
// query and the workspaces query. The shell contributed nothing to the decision except the place to put it.
import { createSignal, lazy, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { nodeReady } from '@acorn/client-core/node/activeNode.ts'
import { prefsOptions, workspacesOptions } from '@acorn/client-core/queries.ts'
import { PrefKeys } from '@acorn/client-core/persistence/prefKeys.ts'

const OnboardingModal = lazy(() => import('./OnboardingModal'))

export default function OnboardingOverlay() {
  // Session-only, exactly as the shell's signal was: dismissing without completing shows the modal again
  // on the next launch, because `onboarded` is only written on completion.
  const [dismissed, setDismissed] = createSignal(false)
  const prefs = createQuery(() => prefsOptions(nodeReady()))
  const workspaces = createQuery(() => workspacesOptions(nodeReady()))
  // Every clause carried over verbatim. `prefs.data !== undefined` is the one that is easy to lose and
  // matters most: without it the modal flashes for an already-onboarded user while prefs are still loading.
  // The workspace count waits for App's first-run bootstrap, so the modal never opens onto an empty picker.
  return (
    <Show
      when={
        !dismissed() &&
        nodeReady() &&
        prefs.data !== undefined &&
        prefs.data?.[PrefKeys.onboarded] !== '1' &&
        (workspaces.data?.length ?? 0) > 0
      }
    >
      <OnboardingModal onClose={() => setDismissed(true)} />
    </Show>
  )
}
