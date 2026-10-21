import { createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId,
  canAddProjectFromFolder,
  canPickFolder,
  clientEvents,
  integrationsOptions,
  pickNodeFolder,
  readJson,
  type ProjectImporterProps,
  projectsKey,
  projectsOptions,
  workspacesKey,
  writeJson,
} from '@acorn/plugin-api/client'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Heading,
  IconButton,
  Inline,
  Input,
  SettingRow,
  Stack,
  Text,
} from '@acorn/plugin-api/ui'
import type { IntegrationsResponse } from '@acorn/protocol/api.ts'
import {
  githubImportRoute,
  reposKey,
  reposRoute,
  type GithubImportAction,
  type GithubImportItem,
  type GithubImportResponse,
  type Repo,
} from '../shared/api'
import { reposOptions } from './queries'

const connectedGithub = (integrations: IntegrationsResponse) =>
  integrations.integrations.some(
    (integration) => integration.providerId === 'github' && integration.status === 'connected',
  )

const githubAccount = (integrations: IntegrationsResponse | undefined) =>
  integrations?.integrations.find((integration) => integration.providerId === 'github')?.account?.label ?? null

// One repository, one decision, taken immediately: the button is the action. Link folder and Clone
// both open the folder picker on the spot; there is no third "defer" action
// (docs/github-integration.md § Importing projects).
//
// Not the `wizard` layout. This is one screen, and the one place it appears in a wizard is first-run
// onboarding, where it is already a step inside onboarding's own; a second wizard here would be one
// nested in the other.
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
  const [filter, setFilter] = createSignal('')
  // Forced, because the Node serves its own copy of the list until it goes stale, so a plain refetch
  // would miss a repository made a minute ago.
  const [refreshing, setRefreshing] = createSignal(false)
  const refreshRepos = async () => {
    setRefreshing(true)
    setError('')
    try {
      queryClient.setQueryData(reposKey, await readJson<Repo[]>(`${reposRoute}?force=true`))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRefreshing(false)
    }
  }
  const shown = () => {
    const needle = filter().trim().toLowerCase()
    return (repos.data ?? []).filter((repo) => `${repo.owner}/${repo.name}`.toLowerCase().includes(needle))
  }
  // Which project already holds each repository, so a row says so. Owner and name compare without
  // case, because GitHub's do.
  const projects = createQuery(() => projectsOptions(true))
  const projectFor = (repo: Repo) =>
    (projects.data ?? []).find(
      (project) =>
        project.github?.owner.toLowerCase() === repo.owner.toLowerCase() &&
        project.github?.name.toLowerCase() === repo.name.toLowerCase(),
    )

  const importOne = async (repo: Repo, action: GithubImportAction) => {
    if (running()) return
    setError('')
    if (!canAddProjectFromFolder()) {
      setError('Choose the local Node to import with a folder picker.')
      return
    }
    const nodeId = activeNodeId()
    // Ask for the folder before anything is written, so cancelling the dialog cancels the import
    // rather than leaving a half-made project behind.
    const path = await pickNodeFolder(nodeId)
    if (!path) return
    if (activeNodeId() !== nodeId || !canAddProjectFromFolder()) {
      setError('The active Node changed. Choose the folder again.')
      return
    }
    const item: GithubImportItem =
      action === 'map' ? { repoId: repo.id, action, path } : { repoId: repo.id, action, parentDir: path }
    setRunning({ repoId: repo.id, action })
    try {
      const response = await writeJson<GithubImportResponse>(
        githubImportRoute,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repositories: [item] }),
        },
        () => "Couldn't add that repository. Try again.",
      )
      const result = response.results[0]
      if (!result?.ok) {
        setError(result?.error ?? "Couldn't add that repository.")
        return
      }
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

  // The frame is the host's when it draws no close control, as the first-run wizard does: a titled
  // box inside a wizard step is a box inside a box.
  const framed = () => props.showClose !== false

  const body = () => (
    <Stack gap="stack">
      <Show when={integrations.data && !githubReady()}>
        <Alert
          tone="muted"
          variant="banner"
          actions={
            <Button onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}>
              Connect GitHub
            </Button>
          }
        >
          Connect GitHub to add its repositories as projects.
        </Alert>
      </Show>
      <Show when={githubReady()}>
        <Show when={githubAccount(integrations.data)}>
          {(login) => <Text emphasis="muted">Connected as @{login()}.</Text>}
        </Show>
        <Show
          when={canAddProjectFromFolder()}
          fallback={
            <Text emphasis="muted">
              {canPickFolder()
                ? 'Choose the local Node to import from GitHub.'
                : 'To choose a folder, use the desktop app.'}
            </Text>
          }
        >
          <Show
            when={!repos.isLoading}
            fallback={
              <EmptyState align="start" size="sm" busy>
                Loading GitHub repositories…
              </EmptyState>
            }
          >
            <Show
              when={repos.data?.length}
              fallback={
                <EmptyState align="start" size="sm">
                  No repositories to show.
                </EmptyState>
              }
            >
              <Show when={error()}>{(text) => <Alert>{text()}</Alert>}</Show>
              <Text emphasis="muted" wrap>
                Clone asks where to put the copy. Link folder asks where your copy already is.
              </Text>
              <Input
                kind="filter"
                label="Filter repositories"
                placeholder="Filter repositories…"
                value={filter()}
                onInput={setFilter}
              />
              <Show when={!shown().length}>
                <EmptyState align="start" size="sm">
                  Nothing matches that filter.
                </EmptyState>
              </Show>
              <Stack gap="none">
                <For each={shown()}>
                  {(repo) => (
                    // Adding the same repository twice is legal, since two clones of one repository
                    // are a supported shape, so a row that already has a project keeps its buttons.
                    <SettingRow
                      label={`${repo.owner}/${repo.name}`}
                      description={[
                        repo.private ? 'Private' : 'Public',
                        ...(projectFor(repo) ? [`Added as ${projectFor(repo)!.name}`] : []),
                      ].join(' · ')}
                    >
                      <Inline gap="row">
                        <Button
                          variant="ghost"
                          size="sm"
                          busy={busy(repo, 'clone')}
                          disabled={!!running()}
                          onPress={() => void importOne(repo, 'clone')}
                        >
                          Clone
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          busy={busy(repo, 'map')}
                          disabled={!!running()}
                          onPress={() => void importOne(repo, 'map')}
                        >
                          Link folder
                        </Button>
                      </Inline>
                    </SettingRow>
                  )}
                </For>
              </Stack>
            </Show>
          </Show>
        </Show>
      </Show>
    </Stack>
  )

  return (
    <Show when={framed()} fallback={body()}>
      <Card>
        <Stack gap="stack">
          <Inline spread>
            <Heading level={3}>Import from GitHub</Heading>
            <Inline gap="row">
              <Show when={githubReady()}>
                <IconButton
                  icon="refresh-cw"
                  label="Refresh repositories"
                  busy={refreshing()}
                  onPress={() => void refreshRepos()}
                />
              </Show>
              <IconButton icon="x" label="Close" onPress={props.onClose} />
            </Inline>
          </Inline>
          {body()}
        </Stack>
      </Card>
    </Show>
  )
}
