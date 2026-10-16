import { createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId,
  canAddProjectFromFolder,
  canPickFolder,
  clientEvents,
  integrationsOptions,
  pickNodeFolder,
  type ProjectImporterProps,
  projectsKey,
  projectsOptions as coreProjectsOptions,
  workspacesKey,
  writeJson,
} from '@acorn/plugin-api/client'
import { Alert, Button, Card, EmptyState, Heading, Inline, SettingRow, Stack, Text } from '@acorn/plugin-api/ui'
import {
  importRoute,
  projectsKey as gitlabProjectsKey,
  type GitlabImportItem,
  type GitlabImportResult,
  type GitlabProject,
} from '../shared/api'
import { samePath } from '../shared/mergeRequestRef'
import { projectsOptions } from './queries'

// The person's gitlab.com projects, each with Clone and Link folder, the importer GitHub's is
// (plugins/github/src/client/GithubImporter.tsx). A project in a nested group is listed by its full path.
export default function GitlabImporter(props: ProjectImporterProps) {
  const queryClient = useQueryClient()
  const integrations = createQuery(() => integrationsOptions(true))
  const connection = () =>
    integrations.data?.integrations.find((entry) => entry.providerId === 'gitlab' && entry.status === 'connected')
  const projects = createQuery(() => projectsOptions(!!connection()))
  const acornProjects = createQuery(() => coreProjectsOptions(true))
  const added = (project: GitlabProject) =>
    (acornProjects.data ?? []).find(
      (candidate) => candidate.repository?.provider === 'gitlab' && samePath(candidate.repository.path, project.path),
    )
  const [running, setRunning] = createSignal<{ id: number; action: 'map' | 'clone' } | null>(null)
  const [error, setError] = createSignal('')

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
        ? { projectId: project.id, action, path: folder }
        : { projectId: project.id, action, parentDir: folder }
    setRunning({ id: project.id, action })
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
      <Show when={integrations.data && !connection()}>
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
      <Show when={connection()}>
        {(connected) => (
          <>
            <Show when={connected().account?.label}>
              {(login) => <Text emphasis="muted">Connected as @{login()}.</Text>}
            </Show>
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
                  <Stack gap="none">
                    <For each={projects.data ?? []}>
                      {(project) => (
                        <SettingRow
                          label={project.path}
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
                                  busy={running()?.id === project.id && running()?.action === action}
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
        )}
      </Show>
    </Stack>
  )

  return (
    <Show when={props.showClose !== false} fallback={body()}>
      <Card>
        <Stack gap="stack">
          <Inline spread>
            <Heading level={3}>Import from GitLab</Heading>
            <Button variant="ghost" size="sm" onPress={props.onClose}>
              Close
            </Button>
          </Inline>
          {body()}
        </Stack>
      </Card>
    </Show>
  )
}
