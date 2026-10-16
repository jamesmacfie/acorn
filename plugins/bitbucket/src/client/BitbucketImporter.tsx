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
  repositoriesKey,
  type BitbucketImportItem,
  type BitbucketImportResult,
  type BitbucketRepository,
} from '../shared/api'
import { sameRepository } from '../shared/pullRequestRef'
import { repositoriesOptions } from './queries'

// The person's Bitbucket repositories, each with Clone and Link folder, the importer GitHub's is
// (plugins/github/src/client/GithubImporter.tsx).
export default function BitbucketImporter(props: ProjectImporterProps) {
  const queryClient = useQueryClient()
  const integrations = createQuery(() => integrationsOptions(true))
  const connections = () =>
    (integrations.data?.integrations ?? []).filter(
      (entry) => entry.providerId === 'bitbucket' && entry.status === 'connected',
    )
  const repositories = createQuery(() => repositoriesOptions(connections().length > 0))
  const acornProjects = createQuery(() => coreProjectsOptions(true))
  const added = (repository: BitbucketRepository) =>
    (acornProjects.data ?? []).find(
      (candidate) =>
        candidate.repository?.provider === 'bitbucket' && sameRepository(candidate.repository.path, repository.path),
    )
  const [running, setRunning] = createSignal<{ repository: BitbucketRepository; action: 'map' | 'clone' } | null>(null)
  const [error, setError] = createSignal('')

  const importOne = async (repository: BitbucketRepository, action: 'map' | 'clone') => {
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
    const item: BitbucketImportItem =
      action === 'map'
        ? { repository: repository.path, action, path: folder }
        : { repository: repository.path, action, parentDir: folder }
    setRunning({ repository, action })
    try {
      const { results } = await writeJson<{ results: BitbucketImportResult[] }>(
        importRoute,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repositories: [item] }),
        },
        () => "Couldn't add that repository. Try again.",
      )
      const result = results[0]
      if (!result?.ok) {
        setError(result?.error ?? "Couldn't add that repository.")
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKey }),
        queryClient.invalidateQueries({ queryKey: workspacesKey }),
        queryClient.invalidateQueries({ queryKey: repositoriesKey }),
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
              Connect Bitbucket
            </Button>
          }
        >
          Connect Bitbucket to add its repositories as projects.
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
                  ? 'Choose the local Node to import from Bitbucket.'
                  : 'To choose a folder, use the desktop app.'}
              </Text>
            }
          >
            <Show
              when={!repositories.isLoading}
              fallback={
                <EmptyState align="start" size="sm" busy>
                  Loading Bitbucket repositories…
                </EmptyState>
              }
            >
              <Show
                when={repositories.data?.length}
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
                <Stack gap="none">
                  <For each={repositories.data ?? []}>
                    {(repository) => (
                      <SettingRow
                        label={repository.path}
                        description={[
                          repository.private ? 'Private' : 'Public',
                          ...(added(repository) ? [`Added as ${added(repository)!.name}`] : []),
                        ].join(' · ')}
                      >
                        <Inline gap="row">
                          <For each={['clone', 'map'] as const}>
                            {(action) => (
                              <Button
                                variant="ghost"
                                size="sm"
                                busy={running()?.repository === repository && running()?.action === action}
                                disabled={!!running()}
                                onPress={() => void importOne(repository, action)}
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
            <Heading level={3}>Import from Bitbucket</Heading>
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
