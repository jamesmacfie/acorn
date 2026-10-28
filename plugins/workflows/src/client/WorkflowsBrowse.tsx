import { createEffect, createMemo, createResource, createSignal, onCleanup, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import {
  formatRelativeTime,
  createWorkspaceWords,
  onPluginFrame,
  projectsOptions,
  tasksOptions,
  toast,
  workspacesOptions,
  wsOnPluginsChanged,
} from '@acorn/plugin-api/client'
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Icon,
  Row,
  Rows,
  SectionHeader,
  sidebarCollapsed,
  Stack,
  Text,
} from '@acorn/plugin-api/ui'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { RunRowInput } from '@acorn/protocol/runs.ts'
import type { WorkflowTriggerDisplayState } from '../shared/workflowTriggers'
import { emptyDefinition } from './editor/draft'
import { defRefKey, parseDefRef, SOURCE_GLYPH } from './editor/draftStore'
import StartDialogHost from './editor/StartDialog'
import WorkflowEditor from './editor/WorkflowEditor'
import TriggerDialogHost from './triggers/TriggerDialog'
import { requestWorkflowTrigger } from './triggers/triggerRequest'
import { triggerStateLabel, whenSummary } from './triggers/triggerModel'
import { openWorkflowRun } from './runs/runStore'
import { runGlyph, runTone, statusLabel } from './runs/runDisplay'
import { workflowsSurfacePath, WORKFLOWS_SOURCE_ID } from './surfacePath'
import { workflowApi } from './workflowsClient'

// The Workflows rail source, as its two regions (docs/workflows/authoring.md § Authoring).
//
// The list is the workspace's definitions — the rows somebody typed here and the files their projects
// committed, read as one — with its recent runs under them. The detail is the editor, addressed by the
// URL, which is what makes a row press, a pasted link and the back button the same thing.

const RECENT_RUNS = 20

// One line, so the icon census sees every name in it: it scans a line for a literal only when the
// line mentions an icon, and a map spread over five lines mentions one on none of them
// (client-core scripts/icon-census.mjs).
const TRIGGER_GLYPH: Record<WorkflowTriggerDisplayState, string> = {
  draft: 'pencil',
  activating: 'loader-circle',
  active: 'clock',
  paused: 'circle-dashed',
  'needs-review': 'triangle-alert',
  unavailable: 'circle-x',
}

/** A collapsed row's mark: the first letters of the name, which tell two workflows apart where two
 *  copies of the same source icon did not. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('') || '?'

/** `repo:nightly` is the layer and the file's id; a reader knows the file. */
const fileName = (source: string): string => `${source.replace(/^[a-z]+:/, '')}.toml`

const triggerTone = (state: WorkflowTriggerDisplayState): 'ok' | 'danger' | 'warn' | undefined =>
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
    // keyed by what `defRefKey` produced. `db%3Aabc` matches no row, so the list would show nothing
    // selected while its editor is open.
    item: () => {
      const ref = parseDefRef(params.id)
      return ref ? defRefKey(ref) : params.id
    },
    projectName: (id: string) => projects.data?.find((project) => project.id === id)?.name,
    workspaceId: () =>
      workspaces.data?.find((entry) => entry.projects.some((project) => project.id === projectId()))?.id ?? '',
    loaded: () => !!workspaces.data,
  }
}

export function WorkflowsBrowseList() {
  const words = createWorkspaceWords()
  // The same signal the source's list column reads, keyed by the source id, so rows and column
  // narrow together.
  const collapsed = sidebarCollapsed(WORKFLOWS_SOURCE_ID)
  const scope = useScope()
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))

  const [defs, { refetch: refetchDefs }] = createResource(
    () => scope.workspaceId() || null,
    async (workspaceId) => workflowApi.defsList(workspaceId),
  )
  const [runs, { refetch: refetchRuns }] = createResource(async () => workflowApi.allRuns().catch(() => ({ runs: [] })))
  const triggers = createQuery(() => ({
    queryKey: ['workflow-triggers'],
    queryFn: () => workflowApi.triggers(),
    refetchInterval: 30_000,
  }))

  // The node says when either moved, on this plugin's own channels.
  createEffect(() => {
    const stopDefs = onPluginFrame('workflows', pluginChannel('workflows', 'defs-changed'), () => void refetchDefs())
    const stopPlugins = wsOnPluginsChanged(() => void refetchDefs())
    const stopRuns = onPluginFrame('workflows', pluginChannel('workflows', 'run-changed'), () => {
      // A baseline run also completes trigger activation. Refresh both read models so the rail does
      // not keep showing “Activating” until its polling interval after the run has settled.
      void refetchRuns()
      void triggers.refetch()
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
  const recent = createMemo<RunRowInput[]>(() =>
    (runs()?.runs ?? []).filter((run) => !!run.taskId && workspaceTasks().has(run.taskId)).slice(0, RECENT_RUNS),
  )
  const projectTriggers = createMemo(() =>
    (triggers.data ?? []).filter((trigger) => trigger.projectId === scope.projectId()),
  )

  // A file that does not parse keys on its own address, so pressing it opens the editor, which says
  // what is wrong with it. It has no id to save a place for, so it stays at the top.
  const items = createMemo(() => [
    ...errors().map((error) => ({ key: error.source, label: fileName(error.source), fixed: true })),
    ...definitions().map((definition) => ({
      key: defRefKey({ source: definition.source, id: definition.id }),
      label: definition.name,
    })),
  ])

  // The order every picker lists, saved for the whole workspace (docs/workflows/routes-and-ui.md § Workflow order).
  // Resolves only once the list has been read back in the new order, which is when `Rows` stops
  // drawing its own copy of it.
  const [orderError, setOrderError] = createSignal('')
  const reorder = async (keys: string[]): Promise<void> => {
    const ids = new Map(
      definitions().map((definition) => [defRefKey({ source: definition.source, id: definition.id }), definition.id]),
    )
    setOrderError('')
    try {
      await workflowApi.defsOrder(
        scope.workspaceId(),
        keys.flatMap((key) => ids.get(key) ?? []),
      )
      await refetchDefs()
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : 'The workflow order could not be saved.')
      throw error
    }
  }

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
  // own unless it is given one.
  const open = (key: string): void => {
    navigate(workflowsSurfacePath(scope.projectId(), key))
  }

  const openRun = (runId: string): void => {
    const run = recent().find((entry) => entry.id === runId)
    const task = (tasks.data ?? []).find((entry) => entry.id === run?.taskId)
    if (task) openWorkflowRun(task, runId, navigate)
  }

  const openTrigger = (triggerId: string): void => {
    const trigger = projectTriggers().find((candidate) => candidate.id === triggerId)
    if (!trigger) return
    const definition = definitions().find((candidate) => candidate.id === trigger.workflowId)
    requestWorkflowTrigger({
      triggerId: trigger.id,
      workflowId: trigger.workflowId,
      name: definition?.name ?? trigger.workflowName,
      projectId: trigger.projectId,
      inputs: definition?.inputs ?? [],
    })
  }

  return (
    <Stack gap="none">
      <SectionHeader
        count={items().length}
        help="A workflow is a list of steps acorn runs for you in a task."
        actions={
          <Button size="sm" disabled={!scope.workspaceId()} onPress={() => void create()}>
            <Icon name="plus" /> New
          </Button>
        }
      >
        Workflows
      </SectionHeader>
      <Show
        when={scope.projectId()}
        fallback={<EmptyState align="start">Choose a project to see its workflows.</EmptyState>}
      >
        <Show
          when={items().length}
          fallback={
            <EmptyState align="start" busy={defs.loading}>
              {defs.loading ? 'Loading…' : 'No workflows yet.'}
            </EmptyState>
          }
        >
          <Rows
            id="workflows.browse.definitions"
            ariaLabel="Workflows"
            items={items()}
            selected={scope.item() ?? null}
            onSelect={open}
            onActivate={open}
            onReorder={collapsed() ? undefined : reorder}
          >
            {(item, itemProps, selected) => (
              <Show
                when={definitions().find(
                  (definition) => defRefKey({ source: definition.source, id: definition.id }) === item.key,
                )}
                fallback={
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
                }
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
                    collapsed={
                      collapsed() ? (
                        <Text tone={definition().problems?.length ? 'warn' : undefined}>
                          {initials(definition().name)}
                        </Text>
                      ) : undefined
                    }
                    meta={
                      <Text emphasis="muted">
                        {[
                          `${definition().steps.length} step${definition().steps.length === 1 ? '' : 's'}`,
                          definition().projectId ? scope.projectName(definition().projectId!) : undefined,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    }
                    trailing={
                      <>
                        <Show when={definition().problems?.length}>
                          <Badge tone="warn" size="xs">
                            Can't read
                          </Badge>
                        </Show>
                        <Show when={definition().agentAuthored}>
                          <Badge size="xs">Agent draft</Badge>
                        </Show>
                        <Icon
                          name={SOURCE_GLYPH[definition().source].icon}
                          title={
                            definition().source === 'database'
                              ? `Saved in this ${words().singular}`
                              : SOURCE_GLYPH[definition().source].title
                          }
                        />
                      </>
                    }
                  >
                    {definition().name}
                  </Row>
                )}
              </Show>
            )}
          </Rows>
          <Show when={orderError()}>
            <Alert tone="danger">{orderError()}</Alert>
          </Show>
        </Show>
      </Show>

      <Show when={projectTriggers().length}>
        <SectionHeader level="group" count={projectTriggers().length}>
          Triggers
        </SectionHeader>
        <Rows
          id="workflows.browse.triggers"
          ariaLabel="Workflow triggers"
          items={projectTriggers().map((trigger) => ({ key: trigger.id, label: trigger.workflowName }))}
          onSelect={openTrigger}
          onActivate={openTrigger}
        >
          {(item, itemProps, selected) => (
            <Show when={projectTriggers().find((trigger) => trigger.id === item.key)}>
              {(trigger) => (
                <Row
                  item={itemProps}
                  selected={selected()}
                  onPress={() => openTrigger(trigger().id)}
                  title={trigger().workflowName}
                  // Collapsed: the state, because a trigger that has stopped checking is the only
                  // reason to look at this list at a glance. The workflow name is the tooltip.
                  collapsed={
                    collapsed() ? (
                      <Icon name={TRIGGER_GLYPH[trigger().state]} tone={triggerTone(trigger().state)} />
                    ) : undefined
                  }
                  meta={<Text emphasis="muted">{whenSummary(trigger())}</Text>}
                  trailing={
                    <Badge tone={triggerTone(trigger().state)} size="xs">
                      {triggerStateLabel(trigger().state)}
                    </Badge>
                  }
                >
                  {trigger().workflowName}
                </Row>
              )}
            </Show>
          )}
        </Rows>
      </Show>

      <Show when={recent().length}>
        <SectionHeader level="group" count={recent().length}>
          Recent runs
        </SectionHeader>
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
                  tip={
                    [(tasks.data ?? []).find((task) => task.id === run().taskId)?.title, run().detail]
                      .filter(Boolean)
                      .join('. ') || undefined
                  }
                  collapsed={
                    collapsed() ? <Icon name={runGlyph(run().status)} tone={runTone(run().status)} /> : undefined
                  }
                  leading={
                    <Icon
                      name={runGlyph(run().status)}
                      tone={runTone(run().status)}
                      spin={run().status === 'running'}
                    />
                  }
                  meta={
                    <Text emphasis="muted">{`${statusLabel(run().status)} · ${formatRelativeTime(run().startedAt)}`}</Text>
                  }
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
          editor's Run button asks for it from the other half of the layout. */}
      <StartDialogHost />
      <TriggerDialogHost />
    </Stack>
  )
}

export function WorkflowsBrowseDetail() {
  const scope = useScope()
  return (
    // `keyed`, so moving to another definition is a fresh editor rather than the same one with the
    // last draft's JSON still in its box.
    <Show
      when={scope.item()}
      keyed
      fallback={<EmptyState title="No workflow open">Choose one, or make a new one.</EmptyState>}
    >
      {(item) => <WorkflowEditor projectId={scope.projectId()} item={item} />}
    </Show>
  )
}
