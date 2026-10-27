import { createEffect, createSignal, For, on, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId,
  canAddProjectFromFolder,
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
  NodePathForm,
  SettingRow,
  Stack,
  Text,
} from '@acorn/plugin-api/ui'
import {
  importRoute,
  repositoriesRoute,
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
  const [filter, setFilter] = createSignal('')
  // Forced, because the Node serves its own copy of the list until it goes stale, so a plain refetch
  // would miss one made a minute ago.
  const [refreshing, setRefreshing] = createSignal(false)
  const refresh = async () => {
    setRefreshing(true)
    setError('')
    try {
      queryClient.setQueryData(
        repositoriesKey,
        await readJson<BitbucketRepository[]>(`${repositoriesRoute}?force=true`),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRefreshing(false)
    }
  }
  const shown = () => {
    const needle = filter().trim().toLowerCase()
    return (repositories.data ?? []).filter((repository) => repository.path.toLowerCase().includes(needle))
  }

  // The row and action whose folder field is open, where the folder dialog can't browse the Node's
  // disk. Clone starts with the last folder typed for Clone. Both drop when the active Node changes,
  // as GithubImporter's do.
  const [typing, setTyping] = createSignal<{
    repository: BitbucketRepository
    action: 'map' | 'clone'
    nodeId: string | null
  } | null>(null)
  const [cloneDir, setCloneDir] = createSignal('')
  createEffect(
    on(
      activeNodeId,
      () => {
        setTyping(null)
        setCloneDir('')
      },
      { defer: true },
    ),
  )
  // By path, not by object, so a background refetch of the list keeps the field open.
  const typingIn = (repository: BitbucketRepository) => {
    const open = typing()
    return open && open.repository.path === repository.path ? open : null
  }

  const importOne = async (repository: BitbucketRepository, action: 'map' | 'clone') => {
    if (running()) return
    setError('')
    const nodeId = activeNodeId()
    if (!canAddProjectFromFolder()) {
      setTyping({ repository, action, nodeId })
      return
    }
    // The folder first, so cancelling the dialog cancels the import.
    const folder = await pickNodeFolder(nodeId)
    if (folder) await send(repository, action, folder, nodeId)
  }

  // Resolves true once the repository is imported, which is when the folder field closes.
  const send = async (
    repository: BitbucketRepository,
    action: 'map' | 'clone',
    folder: string,
    nodeId: string | null,
  ): Promise<boolean> => {
    if (activeNodeId() !== nodeId) {
      setTyping(null)
      setError('The active Node changed. Choose the folder again.')
      return false
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
        return false
      }
      setTyping(null)
      if (action === 'clone') setCloneDir(folder)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsKey }),
        queryClient.invalidateQueries({ queryKey: workspacesKey }),
        queryClient.invalidateQueries({ queryKey: repositoriesKey }),
      ])
      props.onImported(result.acornProjectId ? [result.acornProjectId] : [])
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
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
              <Show when={!typing() && error()}>{(text) => <Alert>{text()}</Alert>}</Show>
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
                  {(repository) => (
                    <SettingRow
                      label={repository.path}
                      description={[
                        repository.private ? 'Private' : 'Public',
                        ...(added(repository) ? [`Added as ${added(repository)!.name}`] : []),
                      ].join(' · ')}
                      layout={typingIn(repository) ? 'stacked' : 'inline'}
                      error={typingIn(repository) ? error() || undefined : undefined}
                    >
                      <Stack gap="row">
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
                        <Show when={typingIn(repository)} keyed>
                          {(open) => (
                            <NodePathForm
                              action={open.action === 'clone' ? 'Clone' : 'Link folder'}
                              busy={!!running()}
                              initial={open.action === 'clone' ? cloneDir() : ''}
                              submit={(folder) => send(repository, open.action, folder, open.nodeId)}
                            />
                          )}
                        </Show>
                      </Stack>
                    </SettingRow>
                  )}
                </For>
              </Stack>
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
            <Inline gap="row">
              <Show when={connections().length > 0}>
                <IconButton
                  icon="refresh-cw"
                  label="Refresh repositories"
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
