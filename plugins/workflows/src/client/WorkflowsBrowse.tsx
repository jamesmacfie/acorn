import { createEffect, createMemo, createResource, onCleanup, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import {
  onPluginFrame,
  pathForTask,
  projectsOptions,
  tasksOptions,
  toast,
  workspacesOptions,
} from '@acorn/plugin-api/client'
import { Alert, Badge, Button, EmptyState, Icon, Row, Rows, SectionHeader, Stack, Text } from '@acorn/plugin-api/ui'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { RunRowInput } from '@acorn/protocol/runs.ts'
import { emptyDefinition } from './editor/draft'
import { defRefKey } from './editor/draftStore'
import StartDialogHost from './editor/StartDialog'
import WorkflowEditor from './editor/WorkflowEditor'
import { workflowsSurfacePath } from './surfacePath'
import { workflowApi } from './workflowsClient'

// The Workflows rail source, as its two regions (docs/workflows.md § Authoring).
//
// The list is the workspace's definitions — the rows somebody typed here and the files their projects
// committed, read as one — with its recent runs under them. The detail is the editor, addressed by the
// URL, which is what makes a row press, a pasted link and the back button the same thing
// (client-core registries/panes/projectSurfaces.ts).

const RECENT_RUNS = 20

// One line, so the icon census sees every name in it: it scans a line for a literal only when the
// line mentions an icon, and a map spread over five lines mentions one on none of them
// (client-core scripts/icon-census.mjs).
const STATUS_GLYPH: Record<string, string> = { running: 'loader-circle', waiting: 'hand', done: 'check', failed: 'circle-x', cancelled: 'ban' }

/** The routed project, and the workspace it belongs to. Both halves ask, so neither can answer
 *  differently from the other. */
function useScope() {
  const params = useParams<{ projectId?: string; id?: string }>()
  const projects = createQuery(() => projectsOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const projectId = () => params.projectId ?? ''
  return {
    projectId,
    item: () => params.id,
    projectName: (id: string) => projects.data?.find((project) => project.id === id)?.name,
    workspaceId: () => workspaces.data?.find((entry) => entry.projects.some((project) => project.id === projectId()))?.id ?? '',
    loaded: () => !!workspaces.data,
  }
}

export function WorkflowsBrowseList() {
  const scope = useScope()
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))

  const [defs, { refetch: refetchDefs }] = createResource(
    () => scope.workspaceId() || null,
    async (workspaceId) => workflowApi.defsList(workspaceId),
  )
  const [runs, { refetch: refetchRuns }] = createResource(async () => workflowApi.allRuns().catch(() => ({ runs: [] })))

  // The node says when either moved. Both channels are this plugin's own; nothing else reads them yet
  // and the rail list is the first consumer of `defs-changed` (../node/index.ts).
  createEffect(() => {
    const stopDefs = onPluginFrame('workflows', pluginChannel('workflows', 'defs-changed'), () => void refetchDefs())
    const stopRuns = onPluginFrame('workflows', pluginChannel('workflows', 'run-changed'), () => void refetchRuns())
    onCleanup(() => {
      stopDefs()
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

  const items = createMemo(() => [
    ...errors().map((error, at) => ({ key: `problem:${at}`, label: error.source })),
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

  const openRun = (runId: string): void => {
    const run = recent().find((entry) => entry.id === runId)
    const task = (tasks.data ?? []).find((entry) => entry.id === run?.taskId)
    if (!task) return
    navigate(`${pathForTask(task)}?pane=workflows&item=${encodeURIComponent(runId)}`)
  }

  return (
    <Stack gap="none">
      <SectionHeader
        count={definitions().length}
        actions={<Button size="sm" disabled={!scope.workspaceId()} onPress={() => void create()}>+ New</Button>}
      >
        Definitions
      </SectionHeader>
      <Show
        when={scope.projectId()}
        fallback={<EmptyState align="start">Choose a project to see the workflows it can run.</EmptyState>}
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
            onSelect={(key) => {
              if (key.startsWith('problem:')) return
              navigate(workflowsSurfacePath(scope.projectId(), key))
            }}
            onActivate={(key) => {
              if (key.startsWith('problem:')) return
              navigate(workflowsSurfacePath(scope.projectId(), key))
            }}
          >
            {(item, itemProps, selected) => (
              <Show
                when={definitions().find((definition) => defRefKey({ source: definition.source, id: definition.id }) === item.key)}
                fallback={(
                  <Row item={itemProps} selected={selected()} variant="stacked" leading={<Icon name="triangle-alert" />}>
                    <Text tone="warn" wrap>{item.label}</Text>
                  </Row>
                )}
              >
                {(definition) => (
                  <Row
                    item={itemProps}
                    selected={selected()}
                    title={definition().problems?.join(' ')}
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
                        <Show when={definition().problems?.length}><Badge tone="warn" size="xs">problem</Badge></Show>
                        <Badge size="xs">{definition().source === 'database' ? 'database' : definition().source}</Badge>
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

      <Show when={recent().length}>
        <SectionHeader count={recent().length}>Recent runs</SectionHeader>
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
                  leading={<Icon name={STATUS_GLYPH[run().status] ?? 'circle'} />}
                  meta={<Text emphasis="muted">{run().detail ?? run().status}</Text>}
                >
                  {run().title}
                </Row>
              )}
            </Show>
          )}
        </Rows>
      </Show>

      <Show when={runs.error}>
        <Alert tone="warn">The run list could not be read from this node.</Alert>
      </Show>
      {/* The one mount for the start dialog: this region is on screen whenever the source is, and the
          editor's Run button asks for it from the other half of the layout (./editor/StartDialog.tsx). */}
      <StartDialogHost />
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
      fallback={(
        <EmptyState align="start">
          Choose a workflow, or make a new one. A workflow is a list of steps acorn runs for you in a task.
        </EmptyState>
      )}
    >
      {(item) => <WorkflowEditor projectId={scope.projectId()} item={item} />}
    </Show>
  )
}
