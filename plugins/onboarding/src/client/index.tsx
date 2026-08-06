// The onboarding plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// It did not exist until Phase 3, for the same reason plugins/memory's did not: the plugin had client code
// but nothing registrable, because App.tsx rendered the modal itself against its own first-run signal. The
// fix was not a shell for an empty init — it was moving the GATE into the plugin (OnboardingOverlay.tsx), at
// which point there is a component to contribute.
//
// Not `required`. A node with onboarding disabled simply never shows the first-run modal; nothing else
// depends on it, which is exactly the degradation the overlay slot gives for free.
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'

const OnboardingOverlay = lazy(() => import('./OnboardingOverlay'))

export const onboardingClientPlugin: ClientPlugin = {
  name: 'onboarding',
  init: (ctx) => {
    // order 0: ahead of every other overlay (config-trust 5, the palettes 10/30). First run should not
    // open behind a dialog, and slots sort on `order` so this is not a registration-order assumption.
    ctx.slots.register({ id: 'onboarding.first-run', slot: 'overlay', order: 0, component: () => <OnboardingOverlay /> })
  },
}
