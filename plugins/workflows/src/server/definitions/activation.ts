import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { homedir } from 'node:os'
import type { NodePlugin, PluginDatabase } from '@acorn/plugin-api/node'
import { loadWorkflowFiles } from './files'
import { getDef, listDefs, mergedList } from './store'
import { workflowFileAuthoring } from '../files/authoring'
import { workflowDraftQueries } from '../publication/draftQueries'
import { workflowPublication } from '../publication/service'
import { publishedWorkflow } from '../publication/store'
import { validateWorkflow } from '../validation/definition'
import type { WorkflowDefsBridge } from '../routes/defs'
import type { WorkflowRunner, WorkflowDef } from '../runs/runner'
import type { WorkflowStartService } from '../runs/admission'

type PluginContext = Parameters<NonNullable<NodePlugin['init']>>[0]
type DefinitionContext = Pick<PluginContext, 'core' | 'dataSources' | 'events'>

/** Row, file, and publication commands behind the device-only definition routes. */
export const workflowDefinitions = (
  store: PluginDatabase,
  ctx: DefinitionContext,
  runner: WorkflowRunner,
  starts: WorkflowStartService,
): { bridge: WorkflowDefsBridge; reconcileDraftQueries: () => Promise<void> } => {
  const core = ctx.core
  // `plugin:workflows:defs-changed` (docs/plugins/events.md § Hearing another plugin): the rail list and
  // the editor re-read on it. The workspace, not the row, because the list is workspace-scoped.
  const defsChanged = (workspaceId: string) => ctx.events.send({ channel: pluginChannel('workflows', 'defs-changed'), workspaceId })

  // The second store a definition can live in (docs/workflows/definitions.md § Database definitions). Every
  // route behind it is device-only, because a row is executable configuration with no committed
  // bytes for the trust snapshot to hash.
  const draftQueries = workflowDraftQueries(store, (scope, id, consumer, remove) => {
    const userId = core.identity.active()
    if (!userId) throw new Error('Draft query references require an active owner')
    return ctx.dataSources.setQueryConsumer(scope, id, consumer,
      { principal: { kind: 'internal', scope: 'service', userId }, signal: AbortSignal.timeout(60_000) }, remove)
  })
  const bridge: WorkflowDefsBridge = {
    files: async request => {
      const result = await workflowFileAuthoring(store, {
        catalog: runner.validationCatalog(),
        scope: async (projectId, source) => {
          const project = await core.projects.byId(projectId)
          if (!project || (source === 'repo' && !project.path)) throw new Error('Choose a local project for file authoring')
          return { root: source === 'repo' ? project.path! : homedir(), workspaceId: project.workspaceId, resolveInRoot: core.fs.resolveInRoot }
        },
        query: async (scope, queryId, revision) => {
          const userId = core.identity.active()
          if (!userId) throw new Error('Export requires an active owner')
          const result = await ctx.dataSources.queryPublication({ ...scope, action: 'inspect', queryId, revision },
            { principal: { kind: 'internal', scope: 'service', userId }, signal: AbortSignal.timeout(60_000) })
          if (!result.published) throw new Error('Publish the saved query before exporting')
          return result.published.content
        },
      })(request)
      const projectId = result.operation?.projectId ?? result.draft?.projectId
      const project = projectId ? await core.projects.byId(projectId) : null
      if (project && request.action !== 'open' && request.action !== 'list') defsChanged(project.workspaceId)
      return result
    },
    ...(() => {
      const invocation = () => {
        const userId = core.identity.active()
        if (!userId) throw new Error('Publication requires an active owner')
        return { principal: { kind: 'internal' as const, scope: 'service' as const, userId }, signal: AbortSignal.timeout(60_000) }
      }
      const publications = workflowPublication(store, {
        catalog: runner.validationCatalog(),
        scope: async (workspaceId, projectId) => {
          const project = projectId ? await core.projects.byId(projectId) : null
          if (projectId && (!project || project.workspaceId !== workspaceId)) throw new Error('Project is outside this workspace')
          return { workspaceId, projectId: projectId ?? '', repoDir: project?.path ?? null, userDir: homedir() }
        },
        query: request => ctx.dataSources.queryPublication(request, invocation()),
        validateQuery: async (scope, reference, context) => { await ctx.dataSources.resolveQuery(scope, reference, context, invocation()) },
        queryConsumer: (scope, id, consumer, remove) => ctx.dataSources.setQueryConsumer(scope, id, consumer, invocation(), remove),
      })
      return {
        preparePublication: publications.prepare,
        discardPublication: publications.discard,
        publications: async (workspaceId: string) => publications.list(workspaceId),
        publish: async (id: string) => {
          const result = await publications.publish(id)
          defsChanged(result.workspaceId)
          return result
        },
      }
    })(),
    list: async (workspaceId) =>
      mergedList(store, workspaceId, await core.projects.byWorkspace(workspaceId), { userDir: homedir(), catalog: runner.validationCatalog() }),
    // A row, or a committed file the editor opens read-only. The merged list carries a summary of
    // each definition and the editor needs the whole thing, so a file id resolves here rather than
    // fattening every list read (docs/workflows/authoring.md § Authoring).
    get: async (id, projectId) => {
      const file = /^(repo|user):(.+)$/.exec(id)
      if (!file) {
        const row = await getDef(store, id)
        if (!row) return null
        const published = row.publishedRevision ? await publishedWorkflow(store, id, row.publishedRevision) : null
        return { ...row, ...(published ? { publishedDef: published.def } : {}) }
      }
      const project = projectId ? await core.projects.byId(projectId) : null
      const loaded = loadWorkflowFiles(file[1] === 'repo' ? project?.path ?? null : null, homedir(), runner.validationCatalog())
      const found = loaded.workflows.find((workflow) => workflow.id === file[2] && workflow.source === file[1])
      if (!found) return null
      const { id: _id, source: _source, ...def } = found
      // `revision: 0` is the marker: a file has no row to save into, so the editor draws it
      // read-only and offers "Copy to database" instead of Save.
      return { id, workspaceId: project?.workspaceId ?? '', projectId: project?.id ?? null, name: found.name, revision: 0, createdAt: 0, updatedAt: 0, def }
    },
    // A row is a draft, so neither write validates. A workflow being built is invalid most of
    // the way: it has no steps the moment it is created, and a step has no prompt until one is
    // typed. `validate` reports and the editor draws what it says; `start` is what refuses.
    create: async ({ workspaceId, projectId, def }) => {
      const row = await draftQueries.create({ workspaceId, projectId, def: def as WorkflowDef })
      defsChanged(workspaceId)
      return { row }
    },
    update: async (id, def, revision) => {
      const answer = await draftQueries.update(id, def as WorkflowDef, revision)
      if (answer && 'row' in answer) defsChanged(answer.row.workspaceId)
      return answer
    },
    remove: async (id) => {
      const row = await getDef(store, id)
      if (!row) return { ok: true }
      await draftQueries.remove(id)
      defsChanged(row.workspaceId)
      return { ok: true }
    },
    validate: async (def, projectId) => {
      const catalog = await starts.catalogForProject(projectId)
      return {
        problems: validateWorkflow(def as WorkflowDef, {
          ...runner.validationCatalog(),
          workflowTargets: catalog.workflows,
        }),
      }
    },
    // Wiring only; the two calls and the repair pass are in ../server/authoring/generationRequest.ts.
    // The runner's validation catalog rather than the pure one built from the kinds alone: it
    // carries each contributed kind's own `validate`, without which a workspace definition with a
    // broken step passes the example filter and teaches the model the mistake.
    generate: async ({ userId, ...request }) => {
      const project = request.projectId ? await core.projects.byId(request.projectId) : null
      if (request.projectId && (!project || project.workspaceId !== request.workspaceId)) {
        return { error: 'The selected project is not in this workspace.' }
      }
      const catalog = await starts.generationCatalog(request.projectId, request.defId)
      const { generateWorkflowRequest } = await import('../authoring/generationRequest')
      return generateWorkflowRequest({
        request,
        catalog,
        validation: { ...runner.validationCatalog(), workflowTargets: catalog.workflows },
        // Rows, which carry the whole definition. The merged list summarises, and a summary is
        // not a worked example.
        examples: (await listDefs(store, request.workspaceId)).map((row) => ({ id: row.id, def: row.def })),
        generateText: (args) => core.models.generateText({ userId, ...args }),
      })
    },
    author: async ({ userId, principal, signal, ...request }) => {
      const projectId = request.scope.projectId
      const project = projectId ? await core.projects.byId(projectId) : null
      if (projectId && (!project || project.workspaceId !== request.scope.workspaceId)) {
        throw new Error('The selected project is not in this workspace.')
      }
      const catalog = await starts.generationCatalog(projectId, request.targetId)
      const { authorWorkflowConversation } = await import('../authoring/conversation')
      return authorWorkflowConversation({
        request,
        catalog,
        validation: { ...runner.validationCatalog(), workflowTargets: catalog.workflows },
        principal,
        signal,
        sources: ctx.dataSources,
        generate: input => core.models.generateText({
          userId, backendId: request.backendId,
          input: { ...input, ...(request.modelId ? { modelId: request.modelId } : {}) },
        }),
      })
    },
    modelBackends: (userId) => core.models.available(userId),
    saveToRepo: async () => ({ error: 'Use Export to repository to review the published dependency graph before writing files.' }),
  }
  return { bridge, reconcileDraftQueries: () => draftQueries.reconcile() }
}
