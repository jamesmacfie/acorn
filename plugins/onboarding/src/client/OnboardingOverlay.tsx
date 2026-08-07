import { createSignal, lazy, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { nodeReady } from '@acorn/client-core/node/activeNode.ts'
import { prefsOptions, workspacesOptions } from '@acorn/client-core/queries.ts'
import { PrefKeys } from '@acorn/client-core/persistence/prefKeys.ts'

const OnboardingModal = lazy(() => import('./OnboardingModal'))

// MODULE scope, not inside the component, and that is the difference between this and the shell's original.
//
// App.tsx held the signal above its `<Show when={nodeReady() && !isRestoring()}>`. This contribution renders
// through the overlay slot host, which is INSIDE that Show — so moving the signal into the component put it in a
// subtree the shell unmounts whenever the node connection drops. A brief node blip disposed the signal, "dismissed"
// reverted to false, and the first-run modal reappeared over the work of someone who had already closed it.
//
// Session-only is still the intent, exactly as before: dismissing without completing shows the modal again on the
// next LAUNCH, because `onboarded` is only written on completion. A module-level signal is per renderer instance,
// which is per window, which is the session — so the property is preserved rather than widened.
const [dismissed, setDismissed] = createSignal(false)

export default function OnboardingOverlay() {
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
