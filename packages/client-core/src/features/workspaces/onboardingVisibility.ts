import { createSignal } from 'solid-js'

const [visible, setVisible] = createSignal(false)
let owner: symbol | undefined

/** The optional onboarding contribution publishes only whether its wizard is on screen. */
export const onboardingWizardVisible = visible

export function ownOnboardingVisibility(): { update: (open: boolean) => void; dispose: () => void } {
  const token = Symbol('onboarding overlay')
  owner = token
  setVisible(false)
  return {
    update: (open) => {
      if (owner === token) setVisible(open)
    },
    dispose: () => {
      if (owner !== token) return
      owner = undefined
      setVisible(false)
    },
  }
}
