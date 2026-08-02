import { useQueryClient } from '@tanstack/solid-query'
import WorkspaceRepoAssignments from '@acorn/client-core/workspaces/WorkspaceRepoAssignments.tsx'
import { saveOnboardingCompletion } from './onboardingCompletion'
import '@acorn/client-core/workspaces/onboarding.css'

// First-run workspace setup (docs/workspaces-and-tasks.md). The bootstrap already put every repo in a Default
// workspace; the shared mapping body re-groups them and (on desktop) maps on-disk checkouts.
// "Done" records the onboarded pref so the modal doesn't reappear. Re-opening the mapping later
// happens via Settings → Workspaces, not here.
export default function OnboardingModal(props: { onClose: () => void }) {
  const qc = useQueryClient()
  async function done() {
    await saveOnboardingCompletion(qc, props.onClose)
  }

  return (
    <div class="overlay-backdrop">
      <div class="overlay onboarding" role="dialog" aria-modal="true">
        <div class="overlay-title">Set up your workspaces</div>
        <div class="overlay-body">
          <WorkspaceRepoAssignments />
        </div>
        <div class="onboarding-footer">
          <button type="button" class="ui-btn" onClick={() => void done()}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
