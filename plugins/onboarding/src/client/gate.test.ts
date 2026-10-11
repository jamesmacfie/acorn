import { describe, expect, it } from 'vitest'
import { onboardingVisible, shouldShowOnboarding, type OnboardingGateInput } from './gate'

const firstRun: OnboardingGateInput = {
  dismissed: false,
  nodeReady: true,
  prefsLoaded: true,
  onboarded: undefined,
  projectCount: 0,
}

describe('shouldShowOnboarding', () => {
  it('opens on a node with no projects that has never been onboarded', () => {
    expect(shouldShowOnboarding(firstRun)).toBe(true)
  })

  it('stays shut once a project exists', () => {
    // A gate on whether a workspace exists would show a set-up user with projects the modal on every
    // launch.
    expect(shouldShowOnboarding({ ...firstRun, projectCount: 3 })).toBe(false)
  })

  it('stays shut once the preference is written', () => {
    expect(shouldShowOnboarding({ ...firstRun, onboarded: '1' })).toBe(false)
  })

  it('waits for both queries rather than flashing', () => {
    expect(shouldShowOnboarding({ ...firstRun, prefsLoaded: false })).toBe(false)
    expect(shouldShowOnboarding({ ...firstRun, projectCount: undefined })).toBe(false)
  })

  it('stays shut when dismissed or before the node is ready', () => {
    expect(shouldShowOnboarding({ ...firstRun, dismissed: true })).toBe(false)
    expect(shouldShowOnboarding({ ...firstRun, nodeReady: false })).toBe(false)
  })
})

describe('onboardingVisible', () => {
  it('keeps an open wizard on screen once its own first step has created a project', () => {
    // "No projects" is the right trigger and the wrong latch. Adding the first project must not
    // unmount the wizard mid-flow and drop the owner into the app on that new project.
    expect(onboardingVisible({ ...firstRun, projectCount: 1, open: true })).toBe(true)
    expect(onboardingVisible({ ...firstRun, projectCount: 1, open: false })).toBe(false)
  })

  it('keeps an open wizard through the preference write that closes it', () => {
    // Finish and Skip both write `onboarded`, and the pref query settles before onClose runs.
    expect(onboardingVisible({ ...firstRun, onboarded: '1', open: true })).toBe(true)
  })

  it('closes on dismissal and hides while the node is away, open or not', () => {
    expect(onboardingVisible({ ...firstRun, open: true, dismissed: true })).toBe(false)
    expect(onboardingVisible({ ...firstRun, open: true, nodeReady: false })).toBe(false)
  })

  it('opens on a first run that has not been opened yet', () => {
    expect(onboardingVisible({ ...firstRun, open: false })).toBe(true)
  })
})
