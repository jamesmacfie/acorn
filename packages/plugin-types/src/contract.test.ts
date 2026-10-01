import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import ts from 'typescript'
import type { CoreServices } from '@acorn/node-core/server/core/index.ts'
import type { ProjectRef } from '@acorn/node-core/server/projects.ts'
import type { TaskRef } from '@acorn/node-core/server/worktrees'
import type { NodePluginContext, PluginRequestContext } from '@acorn/node-core/server/pluginHost'
import type { StoredConnection } from '@acorn/node-core/server/integrations'
import type { ExternalItemStore } from '@acorn/node-core/server/integrations'
import type { CapabilityId } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import type { ModelProviderAdapter } from '@acorn/node-core/server/modelProviders'
import type * as Published from './public.ts'
import type { DataValue, VersionedDataValue } from '@acorn/protocol/dataValues.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { DataBinding, DataField, DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceRequest, DataSourceResult, DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// The drift lock for the hand-written published declarations, copying the pattern
// packages/plugin-sdk/src/contract.test.ts established. See docs/plugins.md § What is published, and
// what acorn promises about it for why the contract modules are hand-written.
//
// Assignability is asserted in both directions per type: one direction alone passes happily when the
// published type is a subset, so dropping a method from `core.tasks` would still let the published
// service accept a real one.

/** Both directions means structurally identical. A type error here is the point of the file. */
type Mutual<A, B> = [A extends B ? true : never, B extends A ? true : never]
const _dataValue: Mutual<DataValue, Published.DataValue> = [true, true]
const _versionedData: Mutual<VersionedDataValue, Published.VersionedDataValue> = [true, true]
const _dataSchema: Mutual<DataSchema, Published.DataSchema> = [true, true]
const _dataBinding: Mutual<DataBinding, Published.DataBinding> = [true, true]
const _dataField: Mutual<DataField, Published.DataField> = [true, true]
const _dataPredicate: Mutual<DataPredicate, Published.DataPredicate> = [true, true]
void [_dataValue, _versionedData, _dataSchema, _dataBinding, _dataField, _dataPredicate]
const _sourceRequest: Mutual<DataSourceRequest, Published.DataSourceRequest> = [true, true]
const _sourceResult: Mutual<DataSourceResult, Published.DataSourceResult> = [true, true]
const _sourceDescription: Mutual<DataSourceDescription, Published.DataSourceDescription> = [true, true]
void [_sourceRequest, _sourceResult, _sourceDescription]
const _sourceRegistry: NodePluginContext['dataSources'] = {} as Published.NodePluginContext['dataSources']
const _publishedSourceRegistry: Published.NodePluginContext['dataSources'] = {} as NodePluginContext['dataSources']
void [_sourceRegistry, _publishedSourceRegistry]

// ── The holes, named one at a time ────────────────────────────────────────────────────────────────
//
// Members the published contract declares as `HostOwned<…>` rather than describing: a framework the
// loaded tier's line already names (drizzle, Zod), or a shape with an owner in another contract. An
// opaque type cannot take part in a two-way comparison in either direction, so each one is subtracted
// from both sides here and everything around it is still compared exactly.
//
// Adding a name to a list below is the deliberate act. It means "acorn no longer promises the shape of
// this one member", and it should be argued for in review like any other narrowing.
const HOLES = {
  // A loaded worker's synchronous RPC can measure a synchronous callback only. The node's
  // collector also times Promise settlement for compiled plugins.
  context: ['storage', 'providers', 'taskChecks', 'telemetry'],
  proc: ['ProcessError'],
  // One member of the batch, because a record's shape lives in `@acorn/protocol/telemetry.ts` and
  // a loaded plugin cannot import protocol. The two `ctx` members beside it are compared in full.
  telemetry: ['records'],
} as const

// Two shapes the published types leave as type parameters rather than describing: a stored connection
// row (a drizzle-inferred core table row) and core's external-item store. Both belong to the
// integrations contract and only a plugin that owns an integration provider ever sees them. Passing the
// real ones here is what lets `routes` and the request context be compared in full, which matters more
// than the two shapes do: every loaded plugin serves routes and almost none owns a provider.
type Real = [StoredConnection, ExternalItemStore]

type Hole<C, K extends keyof C | string> = Omit<C, K>

/** `export const GIT_TIMEOUT_MS = 30_000` has the literal type `30000`, not `number`. Publishing the
 *  literal would make a tuning change a plugin API change, so the published declarations say `number`
 *  and both sides are widened here before they are compared. */
type WidenNumbers<T> = { [K in keyof T]: T[K] extends number ? number : T[K] }

// The host's `NodePluginContext` IS the loaded tier's shape now — the compiled-only members live on
// `CompiledNodePluginContext` beside it — so there is nothing to subtract here any more. `core` is the
// one exception, and not a tier one: its big facets are compared one at a time below.
type LoadedContext = Omit<NodePluginContext, 'core'> & {
  core: WidenNumbers<Omit<CoreServices, 'tasks' | 'projects' | 'proc' | 'context' | 'models' | 'data' | 'secrets' | 'git' | 'telemetry'>>
}
type PublishedContext = Omit<Published.NodePluginContext<Real[0], Real[1]>, 'core'> & {
  core: WidenNumbers<Omit<Published.CoreServices, 'tasks' | 'projects' | 'proc' | 'context' | 'models' | 'data' | 'secrets' | 'git' | 'telemetry'>>
}

const _context: Mutual<Hole<LoadedContext, (typeof HOLES.context)[number]>, Hole<PublishedContext, (typeof HOLES.context)[number]>> = [true, true]
const _task: Mutual<TaskRef, Published.TaskRef> = [true, true]
const _project: Mutual<ProjectRef, Published.ProjectRef> = [true, true]
const _capabilityId: Mutual<CapabilityId<string>, Published.CapabilityId<string>> = [true, true]
const _capabilities: Mutual<NodePluginContext['capabilities'], Published.PluginCapabilities> = [true, true]
const _modelAdapter: Mutual<ModelProviderAdapter, Published.ModelProviderAdapter> = [true, true]
const _modelRegistration: Mutual<NodePluginContext['providers']['model'], Published.PluginProviderRegistry['model']> = [true, true]
const _fs: Mutual<CoreServices['fs'], Published.CoreServices['fs']> = [true, true]
const _git: Mutual<WidenNumbers<CoreServices['git']>, WidenNumbers<Published.CoreServices['git']>> = [true, true]
const _prefs: Mutual<CoreServices['prefs'], Published.CoreServices['prefs']> = [true, true]
const _data: Mutual<CoreServices['data'], Published.CoreServices['data']> = [true, true]
const _identity: Mutual<CoreServices['identity'], Published.CoreServices['identity']> = [true, true]
const _proc: Mutual<WidenNumbers<Hole<CoreServices['proc'], (typeof HOLES.proc)[number]>>, WidenNumbers<Hole<Published.CoreServices['proc'], (typeof HOLES.proc)[number]>>> = [true, true]
const _tasks: Mutual<CoreServices['tasks'], Published.CoreServices['tasks']> = [true, true]
const _projects: Mutual<CoreServices['projects'], Published.CoreServices['projects']> = [true, true]
const _request: Mutual<PluginRequestContext, Published.PluginRequestContext<Real[0], Real[1]>> = [true, true]
// The sink contract, compared apart from the batch's `records`, whose element type is protocol's
// and therefore opaque on the published side.
type BatchOf<T> = T extends { onBatch(sink: (batch: infer B) => void): unknown } ? B : never
const _telemetryBatch: Mutual<Hole<BatchOf<CoreServices['telemetry']>, 'records'>, Hole<BatchOf<Published.CoreTelemetryService>, 'records'>> = [true, true]
const _telemetry: Mutual<Omit<NodePluginContext['telemetry'], 'measure'>, Omit<Published.PluginTelemetry, 'measure'>> = [true, true]
void [_context, _task, _project, _capabilityId, _capabilities, _modelAdapter, _modelRegistration, _fs, _git, _prefs, _data, _identity, _proc, _tasks, _projects, _request, _telemetryBatch, _telemetry]

const _loadedMeasure = (telemetry: Published.PluginTelemetry): number => {
  // @ts-expect-error the synchronous worker call cannot time Promise settlement
  telemetry.measure('async', async () => 42)
  return telemetry.measure('sync', () => 42)
}
void _loadedMeasure

// Public authoring fixture: these are manifest values an out-of-tree package can type without a
// runtime import or a Zod dependency.
const _loadedTool = {
  id: 'lookup',
  description: 'Read one task-local record.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', minLength: 1, maxLength: 100 } },
    required: ['id'],
    additionalProperties: false,
  },
  risk: 'read',
  handler: '/v1/p/example/tools/lookup',
  timeoutMs: 5_000,
  maxOutputBytes: 65_536,
} satisfies Published.PluginAgentToolDescriptor
const _loadedContext = {
  id: 'references', label: 'References', order: 60,
  read: '/v1/p/example/context/references', maxBytes: 32_768, maxTokens: 4_096,
} satisfies Published.PluginContextSectionDescriptor
const _loadedCliCommand = {
  name: 'inspect', title: 'Inspect', summary: 'Read one project.', risk: 'read',
  scope: 'project', capability: 'projects:read', route: { method: 'POST', path: '/cli/inspect' },
  inputSchema: { type: 'object', properties: { nodeId: { type: 'string' }, projectId: { type: 'string' } }, required: ['nodeId', 'projectId'] },
  outputSchema: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] },
} satisfies Published.PluginCliCommandDescriptor
void [_loadedTool, _loadedContext, _loadedCliCommand]

it('leaves most of the surface compared, not substituted', () => {
  // What the assertions above cannot catch: the hole lists growing until the comparison is vacuous.
  // These numbers are the budget. Raising one is a decision; lowering one is progress.
  expect(HOLES.context).toHaveLength(4)
  expect(Object.values(HOLES).flat()).toHaveLength(6)
  // Thirteen of the context's sixteen members are compared in full, `core` facet by facet above, and
  // that is where most of the surface a plugin actually calls lives.
  const published: Array<keyof Published.NodePluginContext> = [
    'name', 'routes', 'schedules', 'dataSources', 'taskChecks',
    'runs', 'audit', 'extensionPoints', 'hooks', 'providers', 'capabilities', 'storage', 'core', 'events',
    'telemetry', 'log',
  ]
  expect(published.length - HOLES.context.length).toBe(12)
})

it('names every capability the first-party plugins publish', () => {
  // The discovery half of the capability work: these ids are declared in
  // `plugins/*/src/contract/` modules a loaded plugin cannot import.
  const ids: Array<keyof Published.CapabilityCatalogue> = [
    'agents.sessionExecute', 'agents.runtime', 'agents.turns', 'agents.requests', 'agents.sessions',
    'agents.draftAttachments', 'agents.harnessRegistry', 'core.taskWorktreeCreated',
    'terminal.sessions', 'terminal.sendToAgent', 'terminal.runTargets', 'terminal.reviewInput.v1', 'notes.store', 'notes.seedTask',
    'memory.library', 'browser.captures', 'github.mirror', 'preview.rules', 'preview.urls',
    'workflows.runner', 'workflows.reviewInput.v1', 'workflows.gates', 'workflows.notices',
  ]
  expect(new Set(ids).size).toBe(23)
})

it('keeps every published declaration module free of runtime statements', () => {
  const src = dirname(fileURLToPath(import.meta.url))
  const files = [join(src, 'public.ts'), ...readdirSync(join(src, 'contracts')).map((file) => join(src, 'contracts', file))]
  expect(files.length).toBeGreaterThan(10)
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const statement of source.statements) {
      expect(
        ts.isTypeAliasDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
        || (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly)
        || (ts.isExportDeclaration(statement) && statement.isTypeOnly),
        `${file}: ${statement.getText(source).slice(0, 80)}`,
      ).toBe(true)
    }
  }
})
