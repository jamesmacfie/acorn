import { For, Show, createSignal } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsOptions, projectsKey, workspacesKey } from '@acorn/client-core/queries.ts'
import type { IntegrationsResponse } from '@acorn/protocol/api.ts'
import { clientEvents } from '@acorn/client-core/registries/clientEvents.ts'
import { taskBridge } from '@acorn/client-core/tasks/taskBridge.ts'
import { writeJson } from '@acorn/client-core/apiClient.ts'
import { githubImportRoute, reposKey, type GithubImportAction, type GithubImportItem, type GithubImportResponse, type Repo } from '../contract/api'
import { reposOptions } from './queries'
import type { ProjectImporterProps } from '@acorn/client-core/registries/projectImporters.ts'

type ImportChoice = GithubImportAction
type Result = GithubImportResponse['results'][number]

const connectedGithub = (integrations: IntegrationsResponse) =>
  integrations.integrations.some((integration) => integration.providerId === 'github' && integration.status === 'connected')

export default function GithubImporter(props: ProjectImporterProps) {
  const queryClient = useQueryClient()
  const integrations = createQuery(() => integrationsOptions(true))
  const githubReady = () => !!integrations.data && connectedGithub(integrations.data)
  const repos = createQuery(() => reposOptions(githubReady()))
  const api = taskBridge()
  const [selected, setSelected] = createSignal<Set<number>>(new Set())
  const [choices, setChoices] = createSignal<Record<number, ImportChoice>>({})
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [results, setResults] = createSignal<Result[]>([])

  const selectedRepos = () => (repos.data ?? []).filter((repo) => selected().has(repo.id))
  const choiceFor = (repo: Repo): ImportChoice => choices()[repo.id] ?? 'defer'
  const toggle = (id: number, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const choose = (id: number, action: ImportChoice) => setChoices((current) => ({ ...current, [id]: action }))

  const importSelected = async () => {
    if (!api || !selectedRepos().length) return
    setBusy(true)
    setError('')
    setResults([])
    try {
      const repositories: GithubImportItem[] = []
      for (const repo of selectedRepos()) {
        const action = choiceFor(repo)
        if (action === 'defer') {
          repositories.push({ repoId: repo.id, action })
          continue
        }
        const path = await api.folderPath.pick()
        if (!path) continue
        repositories.push(action === 'map'
          ? { repoId: repo.id, action, path }
          : { repoId: repo.id, action, parentDir: path })
      }
      if (!repositories.length) return
      const response = await writeJson<GithubImportResponse>(githubImportRoute, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositories }),
      }, (res) => `GitHub import ${res.status}`)
      setResults(response.results)
      setSelected(new Set<number>())
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKey }),
        queryClient.invalidateQueries({ queryKey: workspacesKey }),
        queryClient.invalidateQueries({ queryKey: reposKey }),
      ])
      props.onImported()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="github-importer">
      <div class="onboarding-listhead">
        <strong>Import GitHub repositories</strong>
        <button type="button" class="ui-btn" onClick={props.onClose}>Close</button>
      </div>
      <Show when={integrations.data && !githubReady()}>
        <div class="settings-notice" role="status">
          <p>Connect GitHub to discover repositories and import them into Projects.</p>
          <button type="button" class="ui-btn" onClick={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}>Connect GitHub</button>
        </div>
      </Show>
      <Show when={githubReady()}>
        <Show when={api} fallback={<p class="muted">Folder selection is available in the desktop app.</p>}>
          <Show when={!repos.isLoading} fallback={<p class="muted">Loading GitHub repositories…</p>}>
            <Show when={repos.data?.length} fallback={<p class="muted">No mirrored GitHub repositories yet. Refresh GitHub and try again.</p>}>
              <div class="onboarding-list">
                <For each={repos.data ?? []}>
                  {(repo) => (
                    <label class="onboarding-row github-import-row">
                      <input type="checkbox" checked={selected().has(repo.id)} onChange={(event) => toggle(repo.id, event.currentTarget.checked)} />
                      <span class="onboarding-repo">{repo.owner}/{repo.name}</span>
                      <span class="muted">{repo.private ? 'Private' : 'Public'}</span>
                      <select class="ui-input" value={choiceFor(repo)} onChange={(event) => choose(repo.id, event.currentTarget.value as ImportChoice)}>
                        <option value="defer">Defer</option>
                        <option value="map">Map existing folder</option>
                        <option value="clone">Clone into parent folder</option>
                      </select>
                    </label>
                  )}
                </For>
              </div>
              <p class="muted">Map and clone ask for a folder when you import. Defer keeps the project available without a local checkout.</p>
              <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>
              <button type="button" class="ui-btn" disabled={busy() || !selectedRepos().length} onClick={() => void importSelected()}>
                {busy() ? 'Importing…' : `Import ${selectedRepos().length || ''} selected`}
              </button>
            </Show>
          </Show>
        </Show>
      </Show>
      <Show when={results().length}>
        <div class="github-import-results" role="status">
          <strong>Import results</strong>
          <For each={results()}>
            {(result) => <div class={result.ok ? 'import-result-ok' : 'import-result-error'}>{result.owner && `${result.owner}/${result.name}: `}{result.ok ? `${result.action} (${result.projectId})` : result.error}</div>}
          </For>
        </div>
      </Show>
    </div>
  )
}
