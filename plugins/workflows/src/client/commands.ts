import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  formatRelativeTime,
  localSearch,
  openPane,
  setSelectedSource,
  type CommandExecutionContext,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { workflowApi, type WorkflowDefSummary } from './workflowsClient'
import { requestWorkflowStart } from './editor/startRequest'
import { emptyDefinition } from './editor/draft'
import { defRefKey } from './editor/draftStore'
import { WORKFLOWS_SOURCE_ID, workflowsSurfacePath } from './surfacePath'
import { WORKFLOWS_PANE_ID } from './runs/runPaneModel'

// "Run a workflow", as one search over the definitions this task can run: the files its repository
// commits, the user layer, and the rows the owner saved for this workspace
// (docs/workflows.md § From the command palette).
//
// A `paletteRows` source until 2026-09-03, which put one row per definition into the palette root and
// fetched them on every ⌘K. It is a `search` command now: one named row at the root, one fetch when the
// frame is entered, and local filtering after that
// (client-core/host/registries/commands/localSearch.ts).
//
// Beside it, "Find a run": the same shape over this task's runs, opening each in the run pane
// (./runs/paneContribution.ts). Approving, cancelling and killing a run stay in that pane, for the
// reason they always did (docs/command-palette-and-shortcuts.md).

/** A parse or cycle error from `.acorn/workflows/*.toml`, as a row.
 *
 *  The flat palette floated every source's errors to the top of the list, because an error explains why
 *  a row somebody expected is missing. A frame has no separate error channel for a compiled provider,
 *  so the explanation is a row: first, badged, and carrying no `ref`, which is how `select` knows it is
 *  not a definition. Enter on one restates it and stays. */
const problemItem = (error: { source: string; message: string }, at: number): CommandSearchItem => ({
  id: `problem:${at}`,
  title: `${error.source}: ${error.message}`,
  badge: 'error',
})

/** The definitions this session read, so `select` starts the one that was drawn rather than fetching
 *  again. Keyed on the captured context, which is one object per open session, so a row picked in a
 *  session over another task cannot reach this map at all. */
const loaded = new WeakMap<CommandExecutionContext, Promise<WorkflowDefSummary[]>>()

const readDefs = (context: CommandExecutionContext): Promise<{ workflows: WorkflowDefSummary[]; errors: { source: string; message: string }[] }> =>
  workflowApi.defs(context.taskId ?? '')

export const workflowsCommands: readonly ContributedCommand[] = [
  {
    id: 'workflows.run',
    kind: 'search',
    title: 'Run a workflow',
    hint: 'the workflows committed to this repository',
    keywords: ['workflow', 'start'],
    category: 'action',
    palette: true,
    scope: 'task',
    order: 320,
    // The runner is a node engine, so these routes 503 on a node that does not run terminals. The gate
    // the row source declared, unchanged.
    requires: { plugin: 'terminal' },
    placeholder: 'Find a workflow…',
    ...localSearch(async (context) => {
      const pending = readDefs(context)
      loaded.set(context, pending.then((defs) => defs.workflows))
      const defs = await pending.catch((error: unknown) => {
        loaded.delete(context)
        throw error
      })
      return [
        ...defs.errors.map(problemItem),
        ...defs.workflows.map((workflow): CommandSearchItem => ({
          id: `workflow:${workflow.id}`,
          title: workflow.name,
          // The layer is worth a word here: the list merges this repository's committed files with the
          // rows the owner typed, and the two are not edited in the same place.
          subtitle: `${workflow.steps.length} steps · ${workflow.source === 'database' ? 'saved here' : workflow.source}`,
          ref: workflow.id,
        })),
      ]
    }),
    select: async (item, context): Promise<CommandOutcome> => {
      if (!item.ref) return { effect: 'stay', status: item.title }
      const taskId = context.taskId
      if (!taskId) return COMMAND_CLOSED
      const workflows = await loaded.get(context)
      const def = workflows?.find((candidate) => candidate.id === item.ref)
      if (!def) throw new Error(`'${item.ref}' is no longer a workflow of this task`)
      // The id, not the definition: the node resolves it and, for a committed file, checks the repo
      // trust snapshot against the bytes on disk (./workflowsClient.ts).
      const defId = def.source === 'database' ? def.id : `${def.source}:${def.id}`
      // A definition that asks for something opens the dialog that collects the values; one that asks
      // for nothing starts where it stands (./editor/startRequest.ts).
      //
      // The rail goes to Workflows first, because that is where the dialog is drawn: one mount, in the
      // source's list region, so the editor's Run and this row cannot put two of them on screen.
      if (def.inputs?.some((input) => input.required && !input.default)) {
        setSelectedSource(WORKFLOWS_SOURCE_ID)
        void requestWorkflowStart({ defId, name: def.name, inputs: def.inputs, taskId, projectId: context.projectId ?? undefined })
        return COMMAND_CLOSED
      }
      const result = await workflowApi.start(taskId, { defId })
      if (result.error) throw new Error(result.error)
      return COMMAND_CLOSED
    },
  },
  {
    // Deferred until the run pane existed, because a row that cannot say where it goes is worse than
    // no row. Task scope: a run belongs to a task, and the pane is that task's.
    id: 'workflows.runs.find',
    kind: 'search',
    title: 'Find a run',
    hint: 'a workflow run on this task',
    keywords: ['workflow', 'run', 'history'],
    category: 'action',
    palette: true,
    scope: 'task',
    order: 325,
    requires: { plugin: 'workflows' },
    placeholder: 'Find a run…',
    ...localSearch(async (context) => {
      const runs = await workflowApi.runs(context.taskId ?? '')
      return runs.map((run): CommandSearchItem => ({
        id: `run:${run.id}`,
        title: run.name,
        subtitle: `${run.status} · ${formatRelativeTime(run.createdAt)}`,
        ref: run.id,
      }))
    }),
    select: (item, context): CommandOutcome => {
      const taskId = context.taskId
      if (!item.ref || !taskId) return COMMAND_CLOSED
      openPane(taskId, WORKFLOWS_PANE_ID, { kind: 'workflows:show-run', runId: item.ref })
      return COMMAND_CLOSED
    },
  },
  {
    // The rail toolbar's verb, as a command, so it is reachable from ⌘K as well
    // (docs/command-palette-and-shortcuts.md). Project scope, because a new row is bound to the
    // project the reader is in.
    id: 'workflows.new',
    title: 'New workflow',
    hint: 'a workflow of your own, saved on this node',
    keywords: ['workflow', 'create'],
    category: 'action',
    palette: true,
    scope: 'project',
    order: 330,
    requires: { plugin: 'terminal' },
    run: async (context): Promise<CommandOutcome> => {
      const { workspaceId, projectId, navigate } = context
      if (!workspaceId || !projectId) return { effect: 'stay', status: 'Choose a project first.' }
      const row = await workflowApi.createDef({ workspaceId, projectId, def: emptyDefinition() })
      navigate?.(workflowsSurfacePath(projectId, defRefKey({ source: 'database', id: row.id })))
      return COMMAND_CLOSED
    },
  },
]
