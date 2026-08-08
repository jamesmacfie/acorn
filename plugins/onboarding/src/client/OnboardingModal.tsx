import { useQueryClient } from '@tanstack/solid-query'
import WorkspaceProjectAssignments from '@acorn/client-core/workspaces/WorkspaceProjectAssignments.tsx'
import { saveOnboardingCompletion } from './onboardingCompletion'
import '@acorn/client-core/workspaces/onboarding.css'

// First-run project setup (docs/workspaces-and-tasks.md). Bootstrap only guarantees a Default workspace;
// the owner adds local folders directly or connects GitHub from the Projects manager to import candidates.
// "Done" records the onboarded pref so the modal doesn't reappear. Re-opening the manager later happens
// via Settings → Workspaces.
export default function OnboardingModal(props: { onClose: () => void }) {
  const qc = useQueryClient()
  async function done() {
    await saveOnboardingCompletion(qc, props.onClose)
  }

  return (
    <div class="overlay-backdrop">
      <div class="overlay onboarding" role="dialog" aria-modal="true">
        <div class="overlay-title">Set up your projects</div>
        <div class="overlay-body">
          <WorkspaceProjectAssignments />
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
