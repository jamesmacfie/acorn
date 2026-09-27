import type { QueryContent, QueryScope } from '@acorn/protocol/dataQueries.ts'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { WorkflowDef, WorkflowDefinitionRef, WorkflowInput } from '../../shared/workflowContracts'
import type { WorkflowFileOperation } from '../../shared/workflowFileAuthoring'
import { resolveScopedWorkflowDefinition, type WorkflowResolutionScope } from '../definitions/resolution'
import { publicationStore } from '../publication/store'
import { validateWorkflow, type WorkflowValidationCatalog } from '../validation/definition'
import { workflowSlug, writeWorkflowToml } from '../definitions/toml'
import { fileHash, readWorkflowFile, type WorkflowFileRoot } from './writes'

export type WorkflowExportDeps = {
  catalog: WorkflowValidationCatalog
  query(scope: QueryScope, id: string, revision?: number): Promise<QueryContent>
}

type ExportedWorkflow = {
  path: string
  def: WorkflowDef
  connections: Map<string, WorkflowInput>
}

function bindingUsesParameter(binding: import('@acorn/protocol/dataBindings.ts').DataBinding | undefined, name: string): boolean {
  return binding?.address.from === 'input' && binding.address.name === name
}

function predicateUsesParameter(predicate: import('@acorn/protocol/dataBindings.ts').DataPredicate | undefined, name: string): boolean {
  if (!predicate) return false
  if (predicate.kind === 'comparison') return bindingUsesParameter(predicate.right, name)
  return predicate.predicates.some(child => predicateUsesParameter(child, name))
}

function assertPortableRepositoryQuery(def: WorkflowDef, step: WorkflowDef['steps'][number], path: string): void {
  const query = step.query
  if (!query) return
  if (query.kind === 'saved' || query.content.query.scope.connectionId
    || query.content.query.scope.workspaceId || query.content.query.scope.projectId) {
    throw new Error(`Repository dependency needs portable export: ${path}`)
  }
  const connection = query.content.connection
  if (!connection) return
  if (connection.address.from !== 'input') throw new Error(`Repository dependency has a Node-local connection: ${path}`)
  const binding = query.bindings[connection.address.name]
  const address = binding?.address
  const input = address?.from === 'input' && address.pointer === ''
    ? def.inputs?.find(candidate => candidate.name === address.name)
    : undefined
  if (!input?.connection || input.schema?.type !== 'string'
    || input.connection.source.pluginId !== query.content.query.source.pluginId
    || input.connection.source.sourceId !== query.content.query.source.sourceId) {
    throw new Error(`Repository dependency needs a constrained connection input: ${path}`)
  }
}

/** Capture published graph content before writing any files. Originals remain workspace-owned. */
export async function prepareWorkflowExport(db: PluginDatabase, id: string, scope: WorkflowResolutionScope,
  files: WorkflowFileRoot, deps: WorkflowExportDeps): Promise<Pick<WorkflowFileOperation, 'rootPath' | 'writes' | 'reused' | 'setup'>> {
  const planned = new Map<string, ExportedWorkflow>()
  const visited = new Map<string, ExportedWorkflow>()
  const ordered: { path: string; def: WorkflowDef }[] = []
  const reused = new Map<string, string>()
  const paths = new Set<string>()
  const setup = new Set<string>()
  const connections = new Map<string, WorkflowInput>()
  const reservedInputs = new Set<string>()

  const visit = async (ref: WorkflowDefinitionRef, chain: string[]): Promise<ExportedWorkflow> => {
    const key = ref.source === 'repo' ? `repo:${ref.path}` : `${ref.source}:${ref.id}`
    if (chain.includes(key)) throw new Error('Cannot export a cyclic workflow graph')
    if (chain.length > 4) throw new Error('Workflow nesting exceeds four levels')
    const prior = visited.get(key)
    if (prior) return prior
    if (ref.source === 'user') throw new Error('Copy user-file dependencies into the workspace before exporting')
    const resolved = await resolveScopedWorkflowDefinition(db, ref, { ...scope, userDir: null }, deps.catalog)
    const def = structuredClone(resolved.definition)
    for (const input of def.inputs ?? []) reservedInputs.add(input.name)
    let path: string
    if (ref.source === 'repo') {
      path = ref.path
      const text = readWorkflowFile(files, path)
      if (text === null) throw new Error(`Repository dependency disappeared: ${path}`)
      reused.set(path, fileHash(text))
    } else {
      path = `.acorn/workflows/${workflowSlug(def.name)}.toml`
      if (paths.has(path) || readWorkflowFile(files, path) !== null) throw new Error(`Export path already exists: ${path}`)
      paths.add(path)
      planned.set(key, { path, def, connections: new Map() })
    }
    const requiredConnections = new Map<string, WorkflowInput>()
    for (const step of def.steps) {
      if (step.query) {
        if (ref.source === 'repo') {
          assertPortableRepositoryQuery(def, step, path)
        } else {
          const query = step.query
          if (query.kind === 'saved') publicationStore(db).assertAvailable('query', query.queryId)
          const content = structuredClone(query.kind === 'saved' ? await deps.query(scope, query.queryId, query.revision) : query.content)
          const source = content.query.source
          const connectionKey = JSON.stringify([source, content.query.scope.connectionId, content.connection,
            content.connection?.address.from === 'input' ? query.bindings[content.connection.address.name] : undefined])
          if (content.query.scope.connectionId || content.connection) {
            let input = connections.get(connectionKey)
            if (!input) {
              const name = `connection_${connections.size + 1}`
              input = { name, label: `${source.pluginId} / ${source.sourceId} connection`, schema: { type: 'string' }, required: true, connection: { source } }
              connections.set(connectionKey, input)
            }
            requiredConnections.set(input.name, input)
            if (content.parameters.type !== 'object') throw new Error('Query parameters must be an object')
            const parameter = '__acorn_connection'
            if (content.parameters.properties?.[parameter]) throw new Error('Query reserves the export connection parameter')
            content.parameters = { ...content.parameters, properties: { ...content.parameters.properties, [parameter]: { type: 'string' } }, required: [...content.parameters.required ?? [], parameter] }
            const bindings = { ...query.bindings }
            const original = content.connection?.address
            if (original?.from === 'input') {
              if (Object.values(content.sourceParameters).some(binding => bindingUsesParameter(binding, original.name))
                || predicateUsesParameter(content.query.predicate, original.name)) {
                throw new Error('A connection parameter also used as query data must be separated before export')
              }
              delete bindings[original.name]
              delete content.parameters.properties?.[original.name]
              content.parameters.required = content.parameters.required?.filter(name => name !== original.name)
            }
            content.connection = { address: { from: 'input', name: parameter, pointer: '' } }
            step.query = { kind: 'inline', content, bindings: { ...bindings, [parameter]: { address: { from: 'input', name: input.name, pointer: '' } } } }
            setup.add(`${input.name}: select a connection for ${source.pluginId}/${source.sourceId}; validate project, state, and filter choices on the destination`)
          } else step.query = { kind: 'inline', content, bindings: query.bindings }
          const { connectionId: _connection, workspaceId: _workspace, projectId: _project, ...portableScope } = content.query.scope
          content.query.scope = portableScope
          if (Object.keys(portableScope.parameters).length || content.query.predicate) setup.add(`${path} · ${step.name}: destination choices ${JSON.stringify({ parameters: portableScope.parameters, predicate: content.query.predicate })}`)
        }
      }
      if (step.childWorkflow) {
        if (ref.source === 'repo' && step.childWorkflow.ref.source !== 'repo') throw new Error(`Repository dependency leaves the export scope: ${path}`)
        const child = await visit(step.childWorkflow.ref, [...chain, key])
        step.childWorkflow.ref = { source: 'repo', path: child.path }
        if (ref.source === 'database') {
          for (const [name, input] of child.connections) requiredConnections.set(name, input)
          if (child.connections.size) {
            step.childWorkflow.inputs = {
              ...step.childWorkflow.inputs,
              ...Object.fromEntries([...child.connections].map(([name]) => [name, { address: { from: 'input' as const, name, pointer: '' } }])),
            }
          }
        }
      }
    }
    const result = { path, def, connections: ref.source === 'database' ? requiredConnections : new Map<string, WorkflowInput>() }
    if (ref.source === 'database') {
      def.inputs = [...def.inputs ?? [], ...requiredConnections.values()]
      ordered.push({ path, def })
      planned.set(key, result)
    }
    visited.set(key, result)
    return result
  }
  const root = await visit({ source: 'database', id }, [])
  const inputs = [...connections.values()]
  for (const input of inputs) if (reservedInputs.has(input.name)) throw new Error(`Rename the reserved export input ${input.name}`)
  for (const { def } of planned.values()) {
    const problems = validateWorkflow(def, deps.catalog)
    if (problems.length) throw new Error(`Exported definition needs repair: ${problems.join('; ')}`)
  }
  // Children first; the root appears only after its dependencies have landed.
  return { rootPath: root.path, writes: ordered.map(({ path, def }) => ({ path, text: writeWorkflowToml(def), expectedHash: null, landed: false })), reused: [...reused].map(([path, hash]) => ({ path, hash })), setup: [...setup] }
}
