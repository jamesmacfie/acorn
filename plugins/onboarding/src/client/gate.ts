// Whether the first-run wizard opens. A pure predicate rather than a boolean expression inside the
// component, because this is the part that was wrong and nothing could test it: the original gated on
// "a workspace exists", which is neither necessary nor sufficient. Nothing at boot creates a
// workspace — the Default one is minted lazily by the first project — so a genuinely fresh install
// never saw onboarding, while an established install with fifty projects saw it on every launch.
//
// The condition that actually describes a first run is "this node has no projects yet".

export type OnboardingGateInput = {
  /** Closed for this session without completing. */
  dismissed: boolean
  nodeReady: boolean
  /** False while the prefs query is in flight. */
  prefsLoaded: boolean
  /** PrefKeys.onboarded, as stored. */
  onboarded: string | undefined
  /** undefined while the projects query is in flight. */
  projectCount: number | undefined
}

export function shouldShowOnboarding(input: OnboardingGateInput): boolean {
  if (input.dismissed || !input.nodeReady) return false
  // Both loading clauses matter for the same reason: without them the wizard flashes over the shell
  // of an already-set-up user for as long as the queries take.
  if (!input.prefsLoaded || input.projectCount === undefined) return false
  if (input.onboarded === '1') return false
  return input.projectCount === 0
}

/**
 * Whether the wizard is on screen, which is NOT the same question as whether it should open.
 *
 * "No projects yet" is the right trigger and the wrong latch: the wizard's own first step creates a
 * project, so the condition that opened it stops holding the instant it is used. Re-evaluating the
 * trigger every render therefore unmounted the wizard mid-flow — the owner picked a folder and was
 * dropped into the app on that new project, having never seen the naming step.
 *
 * So opening is a one-way door. Once open it stays open until the wizard closes itself, which it does
 * by writing the `onboarded` preference on both Finish and Skip.
 */
export function onboardingVisible(input: OnboardingGateInput & { open: boolean }): boolean {
  if (input.dismissed || !input.nodeReady) return false
  if (input.open) return true
  return shouldShowOnboarding(input)
}
