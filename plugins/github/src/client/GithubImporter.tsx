import { createSignal, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  canPickFolder, clientEvents, integrationsOptions, pickFolder, type ProjectImporterProps,
  projectsKey, workspacesKey, writeJson,
} from '@acorn/plugin-api/client'
import { Alert, Badge, Button, EmptyState, Row, Rows, Stack, Text, Toolbar } from '@acorn/plugin-api/ui'
import type { IntegrationsResponse } from '@acorn/protocol/api.ts'
import {
  githubImportRoute, reposKey, type GithubImportAction, type GithubImportItem,
  type GithubImportResponse, type Repo,
} from '../shared/api'
import { reposOptions } from './queries'

const connectedGithub = (integrations: IntegrationsResponse) =>
  integrations.integrations.some((integration) => integration.providerId === 'github' && integration.status === 'connected')

const githubAccount = (integrations: IntegrationsResponse | undefined) =>
  integrations?.integrations.find((integration) => integration.providerId === 'github')?.account?.label ?? null

// One repository, one decision, taken immediately: the button is the action. Map and Clone both open
// the folder picker on the spot; there is no third "defer" action
// (docs/github-integration.md § Importing projects).
//
// Not the `wizard` layout the plan named. This is one screen, and the one place it appears in a
// wizard is first-run onboarding, where it is already a step inside onboarding's own; a second
// wizard here would be one nested in the other.
export default function GithubImporter(props: ProjectImporterProps) {
  const queryClient = useQueryClient()
  const integrations = createQuery(() => integrationsOptions(true))
  const githubReady = () => !!integrations.data && connectedGithub(integrations.data)
  const repos = createQuery(() => reposOptions(githubReady()))
  // The row AND the action, so the spinner lands on the button that was pressed. One import at a
  // time: each of these opens a native folder dialog and shells out to git.
  const [running, setRunning] = createSignal<{ repoId: number; action: GithubImportAction } | null>(null)
  const busy = (repo: Repo, action: GithubImportAction) => running()?.repoId === repo.id && running()?.action === action
  const [error, setError] = createSignal('')
  const [imported, setImported] = createSignal<Record<number, string>>({})

  const importOne = async (repo: Repo, action: GithubImportAction) => {
    if (running()) return
    setError('')
    // Ask for the folder before anything is written, so cancelling the dialog cancels the import
    // rather than leaving a half-made project behind.
    const path = await pickFolder()
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

  const repoFor = (id: string): Repo | undefined => (repos.data ?? []).find((repo) => String(repo.id) === id)

  return (
    <Stack gap="stack">
      <Show when={integrations.data && !githubReady()}>
        <Alert
          tone="muted"
          variant="banner"
          actions={
            <Button onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}>Connect GitHub</Button>
          }
        >
          Connect GitHub to discover repositories and import them into Projects.
        </Alert>
      </Show>
      <Show when={githubReady()}>
        <Show when={githubAccount(integrations.data)}>
          {(login) => <Text emphasis="muted">Connected as @{login()}.</Text>}
        </Show>
        <Show
          when={canPickFolder()}
          fallback={<Text emphasis="muted">Folder selection is available in the desktop app.</Text>}
        >
          <Show when={!repos.isLoading} fallback={<EmptyState align="start" busy>Loading GitHub repositories…</EmptyState>}>
            <Show
              when={repos.data?.length}
              fallback={<EmptyState align="start">No mirrored GitHub repositories yet. Refresh GitHub and try again.</EmptyState>}
            >
              <Show when={error()}>{(text) => <Alert>{text()}</Alert>}</Show>
              <Rows
                id="github-import"
                ariaLabel="GitHub repositories"
                items={(repos.data ?? []).map((repo) => ({ key: String(repo.id), label: `${repo.owner}/${repo.name}` }))}
              >
                {(item, itemProps) => {
                  const repo = () => repoFor(item.key)!
                  const added = () => imported()[repo().id]
                  return (
                    <Row
                      item={itemProps}
                      label={item.label}
                      title={item.label}
                      meta={
                        // Importing the same repository twice is legal — two clones of one repo are a
                        // supported shape — so an added row is marked, not disabled.
                        <Show
                          when={added()}
                          fallback={<Text emphasis="muted">{repo().private ? 'Private' : 'Public'}</Text>}
                        >
                          {(action) => <Badge size="xs" tone="ok">Added — {action() === 'clone' ? 'cloned' : 'mapped'}</Badge>}
                        </Show>
                      }
                      trailing={
                        <>
                          <Button size="sm" busy={busy(repo(), 'clone')} disabled={!!running()} onPress={() => void importOne(repo(), 'clone')}>Clone</Button>
                          <Button size="sm" busy={busy(repo(), 'map')} disabled={!!running()} onPress={() => void importOne(repo(), 'map')}>Map folder</Button>
                        </>
                      }
                    >{item.label}</Row>
                  )
                }}
              </Rows>
              <Text emphasis="muted" wrap>
                Both ask for a folder straight away. Repositories you skip stay here — import them
                whenever you're ready.
              </Text>
            </Show>
          </Show>
        </Show>
      </Show>
      <Show when={props.showClose !== false}>
        <Toolbar variant="actions">
          <Button onPress={props.onClose}>Close</Button>
        </Toolbar>
      </Show>
    </Stack>
  )
}
