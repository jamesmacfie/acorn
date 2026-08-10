import { createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { clientEvents, integrationsOptions, type ProjectImporterProps, projectsKey, taskBridge, workspacesKey, writeJson } from '@acorn/plugin-api/client'
import { Button } from '@acorn/plugin-api/ui'
import type { IntegrationsResponse } from '@acorn/protocol/api.ts'
import { githubImportRoute, reposKey, type GithubImportAction, type GithubImportItem, type GithubImportResponse, type Repo } from '../contract/api'
import { reposOptions } from './queries'
import './importer.css'

const connectedGithub = (integrations: IntegrationsResponse) =>
  integrations.integrations.some((integration) => integration.providerId === 'github' && integration.status === 'connected')

const githubAccount = (integrations: IntegrationsResponse | undefined) =>
  integrations?.integrations.find((integration) => integration.providerId === 'github')?.account?.label ?? null

// One repository, one decision, taken immediately. The previous shape — tick a set of checkboxes,
// choose an action per row, then press Import and answer a folder dialog per ticked row — asked the
// owner to hold a plan in their head and only told them where the folders went at the end. Here the
// button IS the action: Map and Clone open the picker on the spot, Defer needs no folder at all.
export default function GithubImporter(props: ProjectImporterProps) {
  const queryClient = useQueryClient()
  const integrations = createQuery(() => integrationsOptions(true))
  const githubReady = () => !!integrations.data && connectedGithub(integrations.data)
  const repos = createQuery(() => reposOptions(githubReady()))
  const api = taskBridge()
  // The row AND the action, so the spinner lands on the button that was pressed. One import at a
  // time: each of these opens a native folder dialog and shells out to git.
  const [running, setRunning] = createSignal<{ repoId: number; action: GithubImportAction } | null>(null)
  const busy = (repo: Repo, action: GithubImportAction) => running()?.repoId === repo.id && running()?.action === action
  const [error, setError] = createSignal('')
  const [imported, setImported] = createSignal<Record<number, string>>({})

  const importOne = async (repo: Repo, action: GithubImportAction) => {
    if (running()) return
    if (!api) return
    setError('')
    // Ask for the folder before anything is written, so cancelling the dialog cancels the import
    // rather than leaving a half-made project behind.
    const path = await api.folderPath.pick()
    if (!path) return
    const item: GithubImportItem = action === 'map'
      ? { repoId: repo.id, action, path }
      : { repoId: repo.id, action, parentDir: path }
    setRunning({ repoId: repo.id, action })
    try {
      const response = await writeJson<GithubImportResponse>(githubImportRoute, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositories: [item] }),
      }, (res) => `GitHub import ${res.status}`)
      const result = response.results[0]
      if (!result?.ok) {
        setError(result?.error ?? 'That repository could not be imported.')
        return
      }
      setImported((current) => ({ ...current, [repo.id]: action }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKey }),
        queryClient.invalidateQueries({ queryKey: workspacesKey }),
        queryClient.invalidateQueries({ queryKey: reposKey }),
      ])
      // Name the project rather than leaving the host to infer it: a map onto an existing path-less
      // project repairs that row instead of adding one, and a before/after diff would miss it.
      props.onImported(result.projectId ? [result.projectId] : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(null)
    }
  }

  return (
    <div class="github-importer">
      <Show when={integrations.data && !githubReady()}>
        <div class="settings-notice" role="status">
          <p>Connect GitHub to discover repositories and import them into Projects.</p>
          <Button onClick={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}>Connect GitHub</Button>
        </div>
      </Show>
      <Show when={githubReady()}>
        <Show when={githubAccount(integrations.data)}>
          {(login) => <p class="muted github-importer-account">Connected as <strong>@{login()}</strong>.</p>}
        </Show>
        <Show when={api} fallback={<p class="muted">Folder selection is available in the desktop app.</p>}>
          <Show when={!repos.isLoading} fallback={<p class="muted">Loading GitHub repositories…</p>}>
            <Show when={repos.data?.length} fallback={<p class="muted">No mirrored GitHub repositories yet. Refresh GitHub and try again.</p>}>
              <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>
              <div class="github-import-list">
                <For each={repos.data ?? []}>
                  {(repo) => (
                    <div class="github-import-row">
                      <span class="github-import-name">{repo.owner}/{repo.name}</span>
                      {/* Importing the same repository twice is legal — two clones of one repo are a
                          supported shape — so an added row is marked, not disabled. */}
                      <span class="github-import-hint" classList={{ 'github-import-added': !!imported()[repo.id] }}>
                        {imported()[repo.id]
                          ? `✓ Added — ${imported()[repo.id] === 'clone' ? 'cloned' : 'mapped'}`
                          : repo.private ? 'Private' : 'Public'}
                      </span>
                      <span class="github-import-actions">
                        <Button size="sm" busy={busy(repo, 'clone')} disabled={!!running()} onClick={() => void importOne(repo, 'clone')}>Clone</Button>
                        <Button size="sm" busy={busy(repo, 'map')} disabled={!!running()} onClick={() => void importOne(repo, 'map')}>Map folder</Button>
                      </span>
                    </div>
                  )}
                </For>
              </div>
              <p class="muted github-importer-foot">
                Both ask for a folder straight away. Repositories you skip stay here — import them
                whenever you're ready.
              </p>
            </Show>
          </Show>
        </Show>
      </Show>
      <Show when={props.showClose !== false}>
        <Button class="github-importer-close" onClick={props.onClose}>Close</Button>
      </Show>
    </div>
  )
}
