// @vitest-environment jsdom
import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { noProjectsScreenVisible } from './noProjectsGate'
import { onboardingWizardVisible, ownOnboardingVisibility } from './onboardingVisibility'

let dispose = () => {}
afterEach(() => dispose())

describe('no-projects screen gate', () => {
  it('shows only for a loaded empty Node after the wizard closes', () => {
    const host = document.createElement('div')
    const [count, setCount] = createSignal<number | undefined>()
    const [error, setError] = createSignal(false)
    const overlay = ownOnboardingVisibility()
    dispose = () => {
      unmount()
      overlay.dispose()
    }
    const unmount = render(
      () => (
        <Show
          when={noProjectsScreenVisible({
            projectCount: count(),
            projectsError: error(),
            wizardVisible: onboardingWizardVisible(),
          })}
        >
          <main>Add a project</main>
        </Show>
      ),
      host,
    )

    expect(host.textContent).toBe('')
    setCount(0)
    expect(host.textContent).toBe('Add a project')
    overlay.update(true)
    expect(host.textContent).toBe('')
    overlay.update(false)
    setError(true)
    expect(host.textContent).toBe('')
    setError(false)
    setCount(1)
    expect(host.textContent).toBe('')
  })

  it('clears an unmounted plugin and ignores its late updates', () => {
    const first = ownOnboardingVisibility()
    first.update(true)
    const second = ownOnboardingVisibility()
    first.dispose()
    first.update(true)
    expect(onboardingWizardVisible()).toBe(false)
    second.update(true)
    expect(onboardingWizardVisible()).toBe(true)
    second.dispose()
    expect(onboardingWizardVisible()).toBe(false)
  })
})
