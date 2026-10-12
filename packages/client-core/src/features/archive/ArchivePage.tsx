import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { SEARCH_MIN_LENGTH, searchRoute, type SearchGroup, type SearchResponse } from '@acorn/protocol/search.ts'
import {
  archivedTasksOptions,
  projectsOptions,
  tasksKey,
  workspacesOptions,
  type ArchivedTask,
} from '../../infra/queries'
import { readJson } from '../../infra/node/apiClient'
import { createActiveWorkspaceId } from '../workspaces/activeWorkspaceId'
import { activateTaskSignals, pathForTask } from '../tasks/activate'
import { restoreTask } from '../tasks/restoreTask'
import { confirmTaskDelete } from '../tasks/confirmTaskArchive'
import { taskBridge } from '../tasks/taskBridge'
import TaskPaneHost from '../tasks/TaskPaneHost'
import { openTarget } from '../notifications/notifications'
import {
  Alert,
  Button,
  DetailColumn,
  EmptyState,
  Input,
  ListColumn,
  ListDetail,
  Row,
  SectionHeader,
  FilterBar,
} from '../../kit/components/primitives'
import { Rows } from '../../kit/components/layout/Rows'
import { Stack } from '../../kit/components/layout/Stack'
import { Inline } from '../../kit/components/layout/Inline'
import { Heading } from '../../kit/components/content/Heading'
import Icon from '../../kit/components/content/Icon'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { Text } from '../../kit/components/content/Text'
import { sidebarCollapsed } from '../../kit/lib/layout/collapseState'
import { retainScroll } from '../../kit/lib/layout/retainScroll'
import { taskOriginAppearance } from '../tasks/origin'
import '../tasks/task-view.css'
import './archive.css'

const SEARCH_DEBOUNCE_MS = 250
const ARCHIVE_SIDEBAR_KEY = 'archive'
// Where the list was left, per workspace, for coming back to the archive from elsewhere. Search
// results are not kept, since the search box starts empty again.
const listOffsets = new Map<string, number>()

const archivedOn = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// The archive: archived tasks newest first, a search over every provider, and a read-only preview of
// the selected task with a way to restore it (docs/workspaces-and-tasks/archive.md § Restoring a task)
// or delete it for good (§ Deleting a task).
//
// The page uses the search seam; it does not own it. The preview is the ordinary pane host on the
// archived task, so only panes whose contribution sets `readsArchived` appear in it. The task never
// enters the task rail, because it is selected here rather than activated.
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
  const tasks = createMemo(() =>
    (archived.data ?? []).filter((task) => workspaceProjectIds()?.has(task.projectId) ?? true),
  )
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

  // One at a time, like restore. The row leaves the list when the tasks change the delete broadcasts
  // refreshes it.
  const [deleting, setDeleting] = createSignal<string | null>(null)
  async function remove(task: ArchivedTask) {
    if (deleting() || restoring()) return
    setError('')
    if (!(await confirmTaskDelete(task)).confirmed) return
    setDeleting(task.id)
    try {
      const result = await taskBridge().task.delete(task.id)
      if (!result.ok) return setError(result.reason)
      if (result.taskIds.includes(selectedId() ?? '')) setSelectedId(null)
      await queryClient.invalidateQueries({ queryKey: tasksKey })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the task.')
    } finally {
      setDeleting(null)
    }
  }

  function openHit(hit: SearchGroup['hits'][number]) {
    if (!hit.taskId || !taskById().has(hit.taskId)) return
    setSelectedId(hit.taskId)
    if (hit.target) openTarget(hit.taskId, hit.target)
  }

  return (
    <ListDetail split listLabel="Archived tasks" collapseKey={ARCHIVE_SIDEBAR_KEY}>
      <ListColumn label="Archived tasks">
        <Show when={!collapsed()}>
          <SectionHeader>Archive</SectionHeader>
          <FilterBar ariaLabel="Search archived tasks">
            <Input
              kind="filter"
              type="search"
              value={text()}
              label="Search archived tasks"
              placeholder="Search archive…"
              title="Searches titles, branches, and agent conversations."
              onInput={setText}
            />
          </FilterBar>
          <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
        </Show>
        <div
          class="scroll"
          ref={(element) =>
            retainScroll(element, {
              key: () => (query() ? 'search' : `tasks:${workspaceId() ?? ''}`),
              read: (key) => listOffsets.get(key) ?? 0,
              write: (key, offset) => {
                if (key !== 'search') listOffsets.set(key, offset)
              },
            })
          }
        >
          <Show
            when={query()}
            fallback={
              <Show
                when={tasks().length}
                fallback={
                  <Show when={!collapsed()}>
                    <EmptyState align="start" size="sm">
                      Nothing archived. Tasks you archive land here, with their history.
                    </EmptyState>
                  </Show>
                }
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
                              <Inline gap="none">
                                <IconButton
                                  icon="archive-restore"
                                  label="Restore task"
                                  busy={restoring() === current().id}
                                  onPress={() => void restore(current())}
                                />
                                <IconButton
                                  icon="trash-2"
                                  label="Delete task"
                                  tone="danger"
                                  busy={deleting() === current().id}
                                  onPress={() => void remove(current())}
                                />
                              </Inline>
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
              fallback={
                <Show when={!collapsed()}>
                  <EmptyState busy align="start" size="sm">
                    Searching…
                  </EmptyState>
                </Show>
              }
            >
              <Show
                when={groups().length}
                fallback={
                  <Show when={!collapsed()}>
                    <EmptyState align="start" size="sm">
                      Nothing archived matches “{query()}”.
                    </EmptyState>
                  </Show>
                }
              >
                <For each={groups()}>
                  {(group) => (
                    <Stack gap="row">
                      <SectionHeader level="group" count={group.hits.length}>
                        {group.label}
                      </SectionHeader>
                      <Show when={!collapsed() && group.status !== 'ok'}>
                        <Text emphasis="muted">
                          {group.status === 'timeout'
                            ? `${group.label} took too long to search.`
                            : `Couldn't search ${group.label}.`}
                        </Text>
                      </Show>
                      <For each={group.hits}>
                        {(hit) => (
                          <Row
                            variant="stacked"
                            selected={hit.taskId === selectedId()}
                            title={hit.title}
                            collapsed={collapsed() ? <Icon name={searchHitGlyph(hit)} /> : undefined}
                            onPress={() => openHit(hit)}
                          >
                            <Text emphasis="strong">{hit.title}</Text>
                            <Text emphasis="muted" wrap>
                              {[
                                hit.taskId && group.providerId !== 'core:tasks'
                                  ? taskById().get(hit.taskId)?.title
                                  : '',
                                hit.preview,
                              ]
                                .filter(Boolean)
                                .join(' — ')}
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
        </div>
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
                    <Heading level={2} eyebrow={`Archived ${archivedOn(task.archivedAt)}`}>
                      {task.title}
                    </Heading>
                    <Text emphasis="muted">
                      {[projectName(task.projectId), task.branch].filter(Boolean).join(' · ')}
                    </Text>
                  </Stack>
                  <Inline>
                    <Button tone="danger" busy={deleting() === task.id} onPress={() => void remove(task)}>
                      Delete task
                    </Button>
                    <Button variant="solid" busy={restoring() === task.id} onPress={() => void restore(task)}>
                      Restore task
                    </Button>
                  </Inline>
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
