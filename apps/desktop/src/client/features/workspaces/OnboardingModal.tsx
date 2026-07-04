import { useQueryClient } from '@tanstack/solid-query'
import { prefsKey } from '../../queries'
import { setPref } from '../../mutations'
import WorkspaceRepoAssignments from './WorkspaceRepoAssignments'
import './onboarding.css'

// First-run workspace setup (docs/workspaces). The bootstrap already put every repo in a Default
// workspace; the shared mapping body re-groups them and (on desktop) maps on-disk checkouts.
// "Done" records the onboarded pref so the modal doesn't reappear. Re-opening the mapping later
// happens via Settings → Workspaces, not here.
export default function OnboardingModal(props: { onClose: () => void }) {
  const qc = useQueryClient()
  async function done() {
    await setPref('onboarded', '1')
    await qc.invalidateQueries({ queryKey: prefsKey })
    props.onClose()
  }

  return (
    <div class="overlay-backdrop">
      <div class="overlay onboarding" role="dialog" aria-modal="true">
        <div class="overlay-title">Set up your workspaces</div>
        <div class="overlay-body">
          <WorkspaceRepoAssignments />
        </div>
        <div class="onboarding-footer">
          <button type="button" class="overlay-btn" onClick={() => void done()}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
