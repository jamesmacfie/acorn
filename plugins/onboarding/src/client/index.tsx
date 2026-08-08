import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'

const OnboardingOverlay = lazy(() => import('./OnboardingOverlay'))

export const onboardingClientPlugin: ClientPlugin = {
  name: 'onboarding',
  init: (ctx) => {
    // order 0: ahead of every other overlay (config-trust 5, the palettes 10/30). First run should not
    // open behind a dialog, and slots sort on `order` so this is not a registration-order assumption.
    ctx.slots.register({ id: 'onboarding.first-run', slot: 'overlay', order: 0, component: () => <OnboardingOverlay /> })
  },
}
