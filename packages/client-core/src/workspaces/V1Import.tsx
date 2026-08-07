import { createResource, createSignal, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { coreImportV1Route, reposKey, type V1ImportProbe, type V1ImportReport } from '@acorn/protocol/api.ts'
import { workspaceAssignmentsKey, workspacesKey } from '../queries'
import { readJson, writeJson } from '../apiClient'

// The config-only V1 importer's one piece of UI (docs/vNext/plan.md § Phase 5,
// plugin-inventory.md § onboarding).
//
// Rendered in two places — the first-run modal and Settings → Workspaces — and in neither of them is it
// a step. Onboarding is one panel today, and a two-step wizard for an optional action that most installs
// will not have anything to offer is ceremony: this renders NOTHING at all unless a V1 install is
// actually present, which on a fresh machine is the normal case.
//
// ponytail: no stepper, no progress bar, no dry-run preview. The probe's counts are the preview.
export default function V1Import(props: { onImported?: () => void }) {
  const queryClient = useQueryClient()
  const [importing, setImporting] = createSignal(false)
  const [report, setReport] = createSignal<V1ImportReport | null>(null)
  const [error, setError] = createSignal('')

  // Speculative and silent: this fires on every first run, and a machine with no V1 install must not see
  // an error for having answered "no". `probeV1Root` on the node is written the same way.
  const [probe] = createResource(async () =>
    readJson<V1ImportProbe>(coreImportV1Route).catch(() => null),
  )

  const run = async () => {
    setError('')
    setImporting(true)
    try {
      const result = await writeJson<V1ImportReport>(
        coreImportV1Route,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        (res) => `import ${res.status}`,
      )
      setReport(result)
      // All three, because the import changes all three: the workspace LIST (new names), the repo list
      // (newly hidden ones) and the ASSIGNMENTS (which repo is in which workspace). Refetching the
      // workspace list alone would leave the mapping body below rendering yesterday's grouping under
      // today's names — the one outcome that would make the import look like it had failed.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspacesKey }),
        queryClient.invalidateQueries({ queryKey: workspaceAssignmentsKey }),
        queryClient.invalidateQueries({ queryKey: reposKey }),
      ])
      props.onImported?.()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      {/* The offer disappears once it has been taken. A control still inviting an action that has just
          happened is how someone clicks it twice and then wonders whether either one worked. */}
      <Show when={probe()?.found && !report()}>
        <div class="settings-notice v1-import" role="region" aria-label="Import from acorn V1">
          <span>
            Found an earlier acorn install: <strong>{probe()?.workspaces}</strong> workspaces,{' '}
            <strong>{probe()?.repos}</strong> repos, <strong>{probe()?.checkouts}</strong> mapped checkouts.
            Its workspace names, grouping, checkout paths and per-repo build settings can be copied over.
            Credentials, tasks, notes and terminal history are not — and nothing in the old install is
            changed.
          </span>
          <Show when={error()}><span class="action-error" role="alert">{error()}</span></Show>
          <button type="button" class="ui-btn" disabled={importing()} onClick={() => void run()}>
            {importing() ? 'Importing…' : 'Import configuration'}
          </button>
        </div>
      </Show>

      <Show when={report()}>
        {(done) => (
          <p class="muted">
            Imported {done().workspacesCreated} workspaces, regrouped {done().reposRegrouped} repos and
            mapped {done().checkoutsImported} checkouts.
            {/* Named rather than counted: "3 paths are wrong" is not actionable, and the whole point of
                importing anyway rather than dropping the row is that the owner can go and fix them. */}
            <Show when={done().checkoutsUnverified.length}>
              {' '}
              These checkout paths no longer exist and need re-pointing in Settings:{' '}
              {done().checkoutsUnverified.join(', ')}.
            </Show>
          </p>
        )}
      </Show>
    </>
  )
}
