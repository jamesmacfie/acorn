import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { SEARCH_MIN_LENGTH, searchRoute, type SearchGroup, type SearchResponse } from '@acorn/protocol/search.ts'
import { archivedTasksOptions, projectsOptions, tasksKey, workspacesOptions, type ArchivedTask } from '../../infra/queries'
import { readJson } from '../../infra/node/apiClient'
import { createActiveWorkspaceId } from '../workspaces/activeWorkspaceId'
import { activateTaskSignals, pathForTask } from '../tasks/activate'
import { restoreTask } from '../tasks/restoreTask'
import TaskPaneHost from '../tasks/TaskPaneHost'
import { openTarget } from '../notifications/notifications'
import { Alert, Button, DetailColumn, EmptyState, Input, ListColumn, ListDetail, Row, SectionHeader } from '../../kit/components/primitives'
import { Rows } from '../../kit/components/layout/Rows'
import { Stack } from '../../kit/components/layout/Stack'
import { Inline } from '../../kit/components/layout/Inline'
import { Heading } from '../../kit/components/content/Heading'
import Icon from '../../kit/components/content/Icon'
import { Text } from '../../kit/components/content/Text'
import { sidebarCollapsed } from '../../kit/lib/collapseState'
import { taskOriginAppearance } from '../tasks/origin'
import '../tasks/task-view.css'
import './archive.css'

const SEARCH_DEBOUNCE_MS = 250
const ARCHIVE_SIDEBAR_KEY = 'archive'

const archivedOn = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// The archive: archived tasks newest first, a search over every provider, and a read-only preview of
// the selected task with a way to restore it (docs/workspaces-and-tasks.md § Restoring a task).
//
// The page uses the search seam; it does not own it. The same providers can back a search across
// active tasks, which is `archived=0` on the same route.
//
// The preview is the ordinary pane host on the archived task. Only panes that opt into stored-history
// reads appear in its layout and switcher (registries/panes.ts § readsArchived). The task never enters
// the task rail, because it is selected here rather than activated.
export default function ArchivePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const archived = createQuery(() => archivedTasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const workspaceId = createActiveWorkspaceId()
  const collapsed = sidebarCollapsed(ARCHIVE_SIDEBAR_KEY)

  const workspaceProjectIds = createMemo(() => {
    const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId())
    return workspace ? new Set(workspace.projects.map((project) => project.id)) : null
  })
  const tasks = createMemo(() => (archived.data ?? []).filter((task) => workspaceProjectIds()?.has(task.projectId) ?? true))
  const taskById = createMemo(() => new Map(tasks().map((task) => [task.id, task])))
  const projectName = (projectId: string) => projects.data?.find((project) => project.id === projectId)?.name ?? ''
  const taskGlyph = (task: ArchivedTask) => task.icon ?? taskOriginAppearance(task.origin).glyph
  const searchHitGlyph = (hit: SearchGroup['hits'][number]) => {
    const task = hit.taskId ? taskById().get(hit.taskId) : undefined
    return task ? taskGlyph(task) : 'search'
  }

  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const selected = () => taskById().get(selectedId() ?? '') ?? null

  // Plugins run in a worker and a cancelled request does not reach them, so every keystroke that got
  // through would keep running on the node. The debounce is what stops that, with the node's own
  // per-provider deadline behind it.
  const [text, setText] = createSignal('')
  const [query, setQuery] = createSignal('')
  createEffect(() => {
    // Match the shared browse sidebars: a collapsed rail always shows every item rather than
    // silently preserving a filter whose input is no longer visible.
    if (collapsed()) {
      setQuery('')
      return
    }
    const value = text().trim()
    const timer = setTimeout(() => setQuery(value.length >= SEARCH_MIN_LENGTH ? value : ''), SEARCH_DEBOUNCE_MS)
    onCleanup(() => clearTimeout(timer))
  })
  const [results] = createResource(
    () => (query() ? { q: query(), workspaceId: workspaceId() } : null),
    async ({ q, workspaceId: scope }) => {
      const params = new URLSearchParams({ q, archived: '1', ...(scope ? { workspaceId: scope } : {}) })
      return (await readJson<SearchResponse>(`${searchRoute}?${params}`)).groups
    },
  )
  // A group with nothing in it says nothing, unless it could not answer at all.
  const groups = (): SearchGroup[] => (results() ?? []).filter((group) => group.hits.length || group.status !== 'ok')

  const [error, setError] = createSignal('')
  const [restoring, setRestoring] = createSignal<string | null>(null)
  async function restore(task: ArchivedTask) {
    if (restoring()) return
    setError('')
    setRestoring(task.id)
    try {
      const result = await restoreTask(task.id)
      if (!result) return
      if (!result.ok) return setError(result.reason)
      // Awaited so the active list already holds the task when the shell looks for it.
      await queryClient.invalidateQueries({ queryKey: tasksKey })
      const active = { ...task, status: 'active' as const }
      activateTaskSignals(active)
      navigate(pathForTask(active))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore the task.')
    } finally {
      setRestoring(null)
    }
  }

  function openHit(hit: SearchGroup['hits'][number]) {
    if (!hit.taskId || !taskById().has(hit.taskId)) return
    setSelectedId(hit.taskId)
    if (hit.target) openTarget(hit.taskId, hit.target)
  }

  return (
    <ListDetail split listLabel="Archived tasks" collapseKey={ARCHIVE_SIDEBAR_KEY}>
      <ListColumn label="Archived tasks" scroll>
        <Stack gap="section">
          <Show when={!collapsed()}>
            <Heading level={1}>Archive</Heading>
            <Input
              type="search"
              value={text()}
              label="Search archived tasks"
              placeholder="Search titles, branches and agent transcripts…"
              onInput={setText}
            />
            <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
          </Show>
          <Show
            when={query()}
            fallback={
              <Show
                when={tasks().length}
                fallback={(
                  <Show when={!collapsed()}>
                    <EmptyState title="Nothing archived">Tasks you archive land here, with their history.</EmptyState>
                  </Show>
                )}
              >
                <Rows
                  id="archive:tasks"
                  ariaLabel="Archived tasks"
                  items={tasks().map((task) => ({ key: task.id, label: task.title }))}
                  selected={selectedId()}
                  onSelect={setSelectedId}
                  onActivate={setSelectedId}
                >
                  {(item, itemProps, isSelected) => {
                    const task = () => taskById().get(item.key)
                    return (
                      <Show when={task()}>
                        {(current) => (
                          <Row
                            item={itemProps}
                            variant="stacked"
                            selected={isSelected()}
                            reveal
                            title={current().title}
                            collapsed={collapsed() ? <Icon name={taskGlyph(current())} /> : undefined}
                            onPress={() => setSelectedId(current().id)}
                            meta={<Text emphasis="muted">{archivedOn(current().archivedAt)}</Text>}
                            trailing={
                              <Button size="sm" busy={restoring() === current().id} onPress={() => void restore(current())}>
                                Restore
                              </Button>
                            }
                          >
                            <Text emphasis="strong">{current().title}</Text>
                            <Text emphasis="muted">
                              {[projectName(current().projectId), current().branch].filter(Boolean).join(' · ')}
                            </Text>
                          </Row>
                        )}
                      </Show>
                    )
                  }}
                </Rows>
              </Show>
            }
          >
            <Show
              when={!results.loading || results()}
              fallback={<Show when={!collapsed()}><Text emphasis="muted">Searching…</Text></Show>}
            >
              <Show
                when={groups().length}
                fallback={(
                  <Show when={!collapsed()}>
                    <EmptyState title="No matches">Nothing archived matches “{query()}”.</EmptyState>
                  </Show>
                )}
              >
                <For each={groups()}>
                  {(group) => (
                    <Stack gap="row">
                      <SectionHeader count={group.hits.length}>{group.label}</SectionHeader>
                      <Show when={!collapsed() && group.status !== 'ok'}>
                        <Text emphasis="muted">{group.status === 'timeout' ? 'Took too long to answer.' : 'Could not answer.'}</Text>
                      </Show>
                      <For each={group.hits}>
                        {(hit) => (
                          <Row
                            variant="stacked"
                            selected={hit.taskId === selectedId()}
                            title={hit.title}
                            collapsed={collapsed()
                              ? <Icon name={searchHitGlyph(hit)} />
                              : undefined}
                            onPress={() => openHit(hit)}
                          >
                            <Text emphasis="strong">{hit.title}</Text>
                            <Text emphasis="muted" wrap>
                              {[hit.taskId && group.providerId !== 'core:tasks' ? taskById().get(hit.taskId)?.title : '', hit.preview].filter(Boolean).join(' — ')}
                            </Text>
                          </Row>
                        )}
                      </For>
                    </Stack>
                  )}
                </For>
              </Show>
            </Show>
          </Show>
        </Stack>
      </ListColumn>
      <DetailColumn>
        <Show
          when={selected()}
          keyed
          fallback={<EmptyState title="Pick an archived task">Its agent sessions and notes open here.</EmptyState>}
        >
          {(task) => (
            <div class="archive-preview">
              <header class="archive-preview-head">
                <Inline spread wrap>
                  <Stack gap="none">
                    <Heading level={2} eyebrow={`Archived ${archivedOn(task.archivedAt)}`}>{task.title}</Heading>
                    <Text emphasis="muted">
                      {[projectName(task.projectId), task.branch].filter(Boolean).join(' · ')}
                    </Text>
                  </Stack>
                  <Button variant="solid" busy={restoring() === task.id} onPress={() => void restore(task)}>
                    Restore task
                  </Button>
                </Inline>
              </header>
              <div class="archive-preview-panes">
                <TaskPaneHost task={task} />
              </div>
            </div>
          )}
        </Show>
      </DetailColumn>
    </ListDetail>
  )
}
