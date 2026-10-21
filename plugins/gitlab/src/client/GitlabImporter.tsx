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
  projectsOptions as coreProjectsOptions,
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
import {
  importRoute,
  projectsRoute,
  projectsKey as gitlabProjectsKey,
  type GitlabImportItem,
  type GitlabImportResult,
  type GitlabProject,
} from '../shared/api'
import { projectAddress, samePath } from '../shared/mergeRequestRef'
import { projectsOptions } from './queries'

// The person's GitLab projects on every connected server, each with Clone and Link folder, the
// importer GitHub's is (plugins/github/src/client/GithubImporter.tsx). A project is listed by its
// address, its server's host and full path, because two servers can hold the same path.
export default function GitlabImporter(props: ProjectImporterProps) {
  const queryClient = useQueryClient()
  const integrations = createQuery(() => integrationsOptions(true))
  const connections = () =>
    (integrations.data?.integrations ?? []).filter(
      (entry) => entry.providerId === 'gitlab' && entry.status === 'connected',
    )
  const projects = createQuery(() => projectsOptions(connections().length > 0))
  const acornProjects = createQuery(() => coreProjectsOptions(true))
  const added = (project: GitlabProject) =>
    (acornProjects.data ?? []).find(
      (candidate) =>
        candidate.repository?.provider === 'gitlab' &&
        candidate.repository.host === project.host &&
        samePath(candidate.repository.path, project.path),
    )
  const [running, setRunning] = createSignal<{ project: GitlabProject; action: 'map' | 'clone' } | null>(null)
  const [error, setError] = createSignal('')
  const [filter, setFilter] = createSignal('')
  // Forced, because the Node serves its own copy of the list until it goes stale, so a plain refetch
  // would miss one made a minute ago.
  const [refreshing, setRefreshing] = createSignal(false)
  const refresh = async () => {
    setRefreshing(true)
    setError('')
    try {
      queryClient.setQueryData(gitlabProjectsKey, await readJson<GitlabProject[]>(`${projectsRoute}?force=true`))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRefreshing(false)
    }
  }
  const shown = () => {
    const needle = filter().trim().toLowerCase()
    return (projects.data ?? []).filter((project) =>
      projectAddress(project.host, project.path).toLowerCase().includes(needle),
    )
  }

  const importOne = async (project: GitlabProject, action: 'map' | 'clone') => {
    if (running()) return
    setError('')
    if (!canAddProjectFromFolder()) {
      setError('Choose the local Node to import with a folder picker.')
      return
    }
    const nodeId = activeNodeId()
    // The folder first, so cancelling the dialog cancels the import.
    const folder = await pickNodeFolder(nodeId)
    if (!folder) return
    if (activeNodeId() !== nodeId || !canAddProjectFromFolder()) {
      setError('The active Node changed. Choose the folder again.')
      return
    }
    const item: GitlabImportItem =
      action === 'map'
        ? { host: project.host, projectId: project.id, action, path: folder }
        : { host: project.host, projectId: project.id, action, parentDir: folder }
    setRunning({ project, action })
    try {
      const { results } = await writeJson<{ results: GitlabImportResult[] }>(
        importRoute,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projects: [item] }) },
        () => "Couldn't add that project. Try again.",
      )
      const result = results[0]
      if (!result?.ok) {
        setError(result?.error ?? "Couldn't add that project.")
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKey }),
        queryClient.invalidateQueries({ queryKey: workspacesKey }),
        queryClient.invalidateQueries({ queryKey: gitlabProjectsKey }),
      ])
      props.onImported(result.acornProjectId ? [result.acornProjectId] : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(null)
    }
  }

  const body = () => (
    <Stack gap="stack">
      <Show when={integrations.data && !connections().length}>
        <Alert
          tone="muted"
          variant="banner"
          actions={
            <Button onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}>
              Connect GitLab
            </Button>
          }
        >
          Connect GitLab to add its projects as projects.
        </Alert>
      </Show>
      <Show when={connections().length}>
        <>
          <Text emphasis="muted">
            Connected as{' '}
            {connections()
              .map((entry) => entry.account?.label ?? entry.label)
              .join(', ')}
            .
          </Text>
          <Show
            when={canAddProjectFromFolder()}
            fallback={
              <Text emphasis="muted">
                {canPickFolder()
                  ? 'Choose the local Node to import from GitLab.'
                  : 'To choose a folder, use the desktop app.'}
              </Text>
            }
          >
            <Show
              when={!projects.isLoading}
              fallback={
                <EmptyState align="start" size="sm" busy>
                  Loading GitLab projects…
                </EmptyState>
              }
            >
              <Show
                when={projects.data?.length}
                fallback={
                  <EmptyState align="start" size="sm">
                    No projects to show.
                  </EmptyState>
                }
              >
                <Show when={error()}>{(text) => <Alert>{text()}</Alert>}</Show>
                <Text emphasis="muted" wrap>
                  Clone asks where to put the copy. Link folder asks where your copy already is.
                </Text>
                <Input
                  kind="filter"
                  label="Filter projects"
                  placeholder="Filter projects…"
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
                    {(project) => (
                      <SettingRow
                        label={projectAddress(project.host, project.path)}
                        description={[
                          project.private ? 'Private' : 'Public',
                          ...(added(project) ? [`Added as ${added(project)!.name}`] : []),
                        ].join(' · ')}
                      >
                        <Inline gap="row">
                          <For each={['clone', 'map'] as const}>
                            {(action) => (
                              <Button
                                variant="ghost"
                                size="sm"
                                busy={running()?.project === project && running()?.action === action}
                                disabled={!!running()}
                                onPress={() => void importOne(project, action)}
                              >
                                {action === 'clone' ? 'Clone' : 'Link folder'}
                              </Button>
                            )}
                          </For>
                        </Inline>
                      </SettingRow>
                    )}
                  </For>
                </Stack>
              </Show>
            </Show>
          </Show>
        </>
      </Show>
    </Stack>
  )

  return (
    <Show when={props.showClose !== false} fallback={body()}>
      <Card>
        <Stack gap="stack">
          <Inline spread>
            <Heading level={3}>Import from GitLab</Heading>
            <Inline gap="row">
              <Show when={connections().length > 0}>
                <IconButton
                  icon="refresh-cw"
                  label="Refresh projects"
                  busy={refreshing()}
                  onPress={() => void refresh()}
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
