import { createEffect, createMemo, createResource, onCleanup, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import {
  formatRelativeTime,
  onPluginFrame,
  projectsOptions,
  tasksOptions,
  toast,
  workspacesOptions,
  wsOnPluginsChanged,
} from '@acorn/plugin-api/client'
import { Alert, Badge, Button, EmptyState, Icon, Row, Rows, SectionHeader, sidebarCollapsed, Stack, Text } from '@acorn/plugin-api/ui'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { RunRowInput } from '@acorn/protocol/runs.ts'
import type { WorkflowScheduleDisplayState } from '../shared/workflowSchedules'
import { emptyDefinition } from './editor/draft'
import { defRefKey, parseDefRef, SOURCE_GLYPH } from './editor/draftStore'
import StartDialogHost from './editor/StartDialog'
import WorkflowEditor from './editor/WorkflowEditor'
import ScheduleDialogHost from './schedules/ScheduleDialog'
import { requestWorkflowSchedule } from './schedules/scheduleRequest'
import { scheduleStateLabel } from './schedules/scheduleModel'
import { openWorkflowRun } from './runs/runStore'
import { runGlyph, runTone, statusLabel } from './runs/runDisplay'
import { workflowsSurfacePath, WORKFLOWS_SOURCE_ID } from './surfacePath'
import { workflowApi } from './workflowsClient'

// The Workflows rail source, as its two regions (docs/workflows/authoring.md § Authoring).
//
// The list is the workspace's definitions — the rows somebody typed here and the files their projects
// committed, read as one — with its recent runs under them. The detail is the editor, addressed by the
// URL, which is what makes a row press, a pasted link and the back button the same thing
// (client-core registries/panes/projectSurfaces.ts).

const RECENT_RUNS = 20

// One line, so the icon census sees every name in it: it scans a line for a literal only when the
// line mentions an icon, and a map spread over five lines mentions one on none of them
// (client-core scripts/icon-census.mjs).
const SCHEDULE_GLYPH: Record<WorkflowScheduleDisplayState, string> = { draft: 'pencil', activating: 'loader-circle', active: 'clock', paused: 'circle-dashed', 'needs-review': 'triangle-alert', unavailable: 'circle-x' }

/** A collapsed row's mark: the first letters of the name, which tell two workflows apart where two
 *  copies of the same source icon did not. */
const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('') || '?'

/** `repo:nightly` is the layer and the file's id; a reader knows the file. */
const fileName = (source: string): string => `${source.replace(/^[a-z]+:/, '')}.toml`

const scheduleTone = (state: WorkflowScheduleDisplayState): 'ok' | 'danger' | 'warn' | undefined =>
  state === 'active' ? 'ok' : state === 'unavailable' ? 'danger' : state === 'needs-review' ? 'warn' : undefined

/** The routed project, and the workspace it belongs to. Both halves ask, so neither can answer
 *  differently from the other. */
function useScope() {
  const params = useParams<{ projectId?: string; id?: string }>()
  const projects = createQuery(() => projectsOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const projectId = () => params.projectId ?? ''
  return {
    projectId,
    // Back through `parseDefRef`, because the address escapes the `db:` separator and the rows are
    // keyed by what `defRefKey` produced. `db%3Aabc` matches no row, which is why the list showed
    // nothing selected while its editor was open.
    item: () => {
      const ref = parseDefRef(params.id)
      return ref ? defRefKey(ref) : params.id
    },
    projectName: (id: string) => projects.data?.find((project) => project.id === id)?.name,
    workspaceId: () => workspaces.data?.find((entry) => entry.projects.some((project) => project.id === projectId()))?.id ?? '',
    loaded: () => !!workspaces.data,
  }
}

export function WorkflowsBrowseList() {
  // The same signal the source's list column reads, keyed by the source id, so rows and column
  // narrow together (client-core kit/lib/layout/collapseState.ts).
  const collapsed = sidebarCollapsed(WORKFLOWS_SOURCE_ID)
  const scope = useScope()
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))

  const [defs, { refetch: refetchDefs }] = createResource(
    () => scope.workspaceId() || null,
    async (workspaceId) => workflowApi.defsList(workspaceId),
  )
  const [runs, { refetch: refetchRuns }] = createResource(async () => workflowApi.allRuns().catch(() => ({ runs: [] })))
  const schedules = createQuery(() => ({
    queryKey: ['workflow-schedules'],
    queryFn: () => workflowApi.schedules(),
    refetchInterval: 30_000,
  }))

  // The node says when either moved. Both channels are this plugin's own; nothing else reads them yet
  // and the rail list is the first consumer of `defs-changed` (../node/index.ts).
  createEffect(() => {
    const stopDefs = onPluginFrame('workflows', pluginChannel('workflows', 'defs-changed'), () => void refetchDefs())
    const stopPlugins = wsOnPluginsChanged(() => void refetchDefs())
    const stopRuns = onPluginFrame('workflows', pluginChannel('workflows', 'run-changed'), () => {
      // A baseline run also completes schedule activation. Refresh both read models so the rail does
      // not keep showing “Activating” until its polling interval after the run has settled.
      void refetchRuns()
      void schedules.refetch()
    })
    onCleanup(() => {
      stopDefs()
      stopPlugins()
      stopRuns()
    })
  })

  const definitions = () => defs()?.workflows ?? []
  const errors = () => defs()?.errors ?? []

  // Node-wide runs, narrowed to this workspace's tasks: the route is the merged run list and the rail
  // is workspace-scoped (@acorn/protocol/runs.ts).
  const workspaceTasks = createMemo(() => {
    const ids = new Set((tasks.data ?? []).map((task) => task.id))
    return ids
  })
  const recent = createMemo<RunRowInput[]>(() => (runs()?.runs ?? [])
    .filter((run) => !!run.taskId && workspaceTasks().has(run.taskId))
    .slice(0, RECENT_RUNS))
  const projectSchedules = createMemo(() => (schedules.data ?? []).filter(schedule => schedule.projectId === scope.projectId()))

  // A file that does not parse keys on its own address, so pressing it opens the editor, which says
  // what is wrong with it.
  const items = createMemo(() => [
    ...errors().map((error) => ({ key: error.source, label: fileName(error.source) })),
    ...definitions().map((definition) => ({ key: defRefKey({ source: definition.source, id: definition.id }), label: definition.name })),
  ])

  const create = async (): Promise<void> => {
    const workspaceId = scope.workspaceId()
    if (!workspaceId) return
    try {
      const row = await workflowApi.createDef({
        workspaceId,
        ...(scope.projectId() ? { projectId: scope.projectId() } : {}),
        def: emptyDefinition(),
      })
      navigate(workflowsSurfacePath(scope.projectId(), defRefKey({ source: 'database', id: row.id })))
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That workflow could not be created.', { tone: 'danger' })
    }
  }

  // The three ways into a definition: a mouse press on the row, and the collection's own select and
  // activate for the keyboard. All of them come here, because a `Row` in a `Rows` has no click of its
  // own unless it is given one (client-core kit/components/layout/Row.tsx).
  const open = (key: string): void => {
    navigate(workflowsSurfacePath(scope.projectId(), key))
  }

  const openRun = (runId: string): void => {
    const run = recent().find((entry) => entry.id === runId)
    const task = (tasks.data ?? []).find((entry) => entry.id === run?.taskId)
    if (task) openWorkflowRun(task, runId, navigate)
  }

  const openSchedule = (scheduleId: string): void => {
    const schedule = projectSchedules().find(candidate => candidate.id === scheduleId)
    if (!schedule) return
    const definition = definitions().find(candidate => candidate.id === schedule.workflowId)
    requestWorkflowSchedule({
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
      name: definition?.name ?? schedule.workflowName,
      projectId: schedule.projectId,
      inputs: definition?.inputs ?? [],
    })
  }

  return (
    <Stack gap="none">
      <SectionHeader
        count={items().length}
        help="A workflow is a list of steps acorn runs for you in a task."
        actions={<Button size="sm" disabled={!scope.workspaceId()} onPress={() => void create()}><Icon name="plus" /> New</Button>}
      >
        Workflows
      </SectionHeader>
      <Show
        when={scope.projectId()}
        fallback={<EmptyState align="start">Choose a project to see its workflows.</EmptyState>}
      >
        <Show
          when={items().length}
          fallback={<EmptyState align="start" busy={defs.loading}>{defs.loading ? 'Loading…' : 'No workflows yet.'}</EmptyState>}
        >
          <Rows
            id="workflows.browse.definitions"
            ariaLabel="Workflows"
            items={items()}
            selected={scope.item() ?? null}
            onSelect={open}
            onActivate={open}
          >
            {(item, itemProps, selected) => (
              <Show
                when={definitions().find((definition) => defRefKey({ source: definition.source, id: definition.id }) === item.key)}
                fallback={(
                  <Row
                    item={itemProps}
                    selected={selected()}
                    variant="stacked"
                    onPress={() => open(item.key)}
                    title={item.label}
                    tip={errors().find((error) => error.source === item.key)?.message}
                    collapsed={collapsed() ? <Icon name="triangle-alert" tone="warn" /> : undefined}
                    leading={<Icon name="triangle-alert" tone="warn" />}
                  >
                    <Stack gap="none">
                      <Text>{item.label}</Text>
                      <Text emphasis="muted">{errors().find((error) => error.source === item.key)?.message}</Text>
                    </Stack>
                  </Row>
                )}
              >
                {(definition) => (
                  <Row
                    item={itemProps}
                    selected={selected()}
                    onPress={() => open(item.key)}
                    title={definition().name}
                    tip={definition().problems?.join(' ') || undefined}
                    // Collapsed: the name's first letters, warn-toned when it has a problem, which is
                    // the reason a reader would go looking. The name is the tooltip.
                    collapsed={collapsed()
                      ? <Text tone={definition().problems?.length ? 'warn' : undefined}>{initials(definition().name)}</Text>
                      : undefined}
                    meta={(
                      <Text emphasis="muted">
                        {[
                          `${definition().steps.length} step${definition().steps.length === 1 ? '' : 's'}`,
                          definition().projectId ? scope.projectName(definition().projectId!) : undefined,
                        ].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                    trailing={(
                      <>
                        <Show when={definition().problems?.length}><Badge tone="warn" size="xs">Can't read</Badge></Show>
                        <Icon name={SOURCE_GLYPH[definition().source].icon} title={SOURCE_GLYPH[definition().source].title} />
                      </>
                    )}
                  >
                    {definition().name}
                  </Row>
                )}
              </Show>
            )}
          </Rows>
        </Show>
      </Show>

      <Show when={projectSchedules().length}>
        <SectionHeader level="group" count={projectSchedules().length}>Schedules</SectionHeader>
        <Rows
          id="workflows.browse.schedules"
          ariaLabel="Workflow schedules"
          items={projectSchedules().map(schedule => ({ key: schedule.id, label: schedule.workflowName }))}
          onSelect={openSchedule}
          onActivate={openSchedule}
        >
          {(item, itemProps, selected) => (
            <Show when={projectSchedules().find(schedule => schedule.id === item.key)}>{schedule => (
              <Row item={itemProps} selected={selected()} onPress={() => openSchedule(schedule().id)}
                title={schedule().workflowName}
                // Collapsed: the state, because a schedule that has stopped checking is the only
                // reason to look at this list at a glance. The workflow name is the tooltip.
                collapsed={collapsed() ? <Icon name={SCHEDULE_GLYPH[schedule().state]} tone={scheduleTone(schedule().state)} /> : undefined}
                meta={<Text emphasis="muted">{schedule().nextRunAt ? new Date(schedule().nextRunAt!).toLocaleString() : schedule().error ?? 'No check planned'}</Text>}
                trailing={<Badge tone={scheduleTone(schedule().state)} size="xs">{scheduleStateLabel(schedule().state)}</Badge>}>
                {schedule().workflowName}
              </Row>
            )}</Show>
          )}
        </Rows>
      </Show>

      <Show when={recent().length}>
        <SectionHeader level="group" count={recent().length}>Recent runs</SectionHeader>
        <Rows
          id="workflows.browse.runs"
          ariaLabel="Recent runs"
          items={recent().map((run) => ({ key: run.id, label: run.title }))}
          onSelect={openRun}
          onActivate={openRun}
        >
          {(item, itemProps, selected) => (
            <Show when={recent().find((run) => run.id === item.key)}>
              {(run) => (
                <Row
                  item={itemProps}
                  selected={selected()}
                  onPress={() => openRun(run().id)}
                  title={run().title}
                  // Which task, and why it stopped, so two runs of one workflow read apart.
                  tip={[(tasks.data ?? []).find((task) => task.id === run().taskId)?.title, run().detail].filter(Boolean).join('. ') || undefined}
                  collapsed={collapsed() ? <Icon name={runGlyph(run().status)} tone={runTone(run().status)} /> : undefined}
                  leading={<Icon name={runGlyph(run().status)} tone={runTone(run().status)} spin={run().status === 'running'} />}
                  meta={<Text emphasis="muted">{`${statusLabel(run().status)} · ${formatRelativeTime(run().startedAt)}`}</Text>}
                >
                  {run().title}
                </Row>
              )}
            </Show>
          )}
        </Rows>
      </Show>

      <Show when={runs.error}>
        <Alert tone="warn">Couldn't load recent runs.</Alert>
      </Show>
      {/* The one mount for the start dialog: this region is on screen whenever the source is, and the
          editor's Run button asks for it from the other half of the layout (./editor/StartDialog.tsx). */}
      <StartDialogHost />
      <ScheduleDialogHost />
    </Stack>
  )
}

export function WorkflowsBrowseDetail() {
  const scope = useScope()
  return (
    // `keyed`, so moving to another definition is a fresh editor rather than the same one with the
    // last draft's JSON still in its box (client-core § useParams).
    <Show
      when={scope.item()}
      keyed
      fallback={<EmptyState title="No workflow open">Choose one, or make a new one.</EmptyState>}
    >
      {(item) => <WorkflowEditor projectId={scope.projectId()} item={item} />}
    </Show>
  )
}
