import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  localSearch,
  type CommandExecutionContext,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { workflowApi, type WorkflowDefSummary } from './workflowsClient'

// "Run a workflow", as one search over the definitions this task can run: the files its repository
// commits, the user layer, and the rows the owner saved for this workspace
// (docs/workflows.md § From the command palette).
//
// A `paletteRows` source until 2026-09-03, which put one row per definition into the palette root and
// fetched them on every ⌘K. It is a `search` command now: one named row at the root, one fetch when the
// frame is entered, and local filtering after that
// (client-core/host/registries/commands/localSearch.ts).
//
// **What is not here, and why.** The catalogue also asked for "find an active or recent run and open
// it". There is nowhere to open one: this plugin ships no pane and no run surface on either host, and
// the only client reader of `workflowApi.runs` is plugins/agents' task sidebar, which draws a run's
// *steps* into its roster and keys selection on a managed-session id that a workflow step does not
// have. A search whose row cannot name where it goes is worse than no search
// (docs/command-palette-and-shortcuts.md), so the row is
// deferred in the catalogue with that evidence rather than pointed at a pane it cannot address.
// Approving, cancelling and killing a run stay in the run surface for the reason they always did.

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
      // A definition that asks for something cannot be started from a row in a list. The start dialog
      // that collects the values lands in phase 3 of docs/future/workflows/; until then the frame says
      // where to go rather than starting a run with an empty input.
      if (def.inputs?.some((input) => input.required && !input.default)) {
        return { effect: 'stay', status: `${def.name} needs its inputs filled in. Run it from the workflow editor.` }
      }
      // The id, not the definition: the node resolves it and, for a committed file, checks the repo
      // trust snapshot against the bytes on disk. `start` turns a thrown HTTP error into `{ error }`
      // and handles the needs-trust prompt (./workflowsClient.ts).
      const result = await workflowApi.start(taskId, { defId: def.source === 'database' ? def.id : `${def.source}:${def.id}` })
      if (result.error) throw new Error(result.error)
      return COMMAND_CLOSED
    },
  },
]
