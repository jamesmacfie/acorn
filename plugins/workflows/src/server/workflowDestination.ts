import type { QueryReference, QueryScope } from '@acorn/protocol/dataQueries.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { ResolvedWorkflowGraph } from '../shared/workflowContracts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { resolveDataBinding } from '@acorn/protocol/dataQueryResolution.ts'
import { dataBindingSchema } from '@acorn/protocol/dataBindings.ts'

export function destinationQuery(reference: QueryReference, scope: QueryScope): QueryReference {
  if (reference.kind !== 'inline' || reference.content.query.scope.workspaceId || reference.content.query.scope.projectId) return reference
  return { ...reference, content: { ...reference.content, query: { ...reference.content.query, scope: { ...reference.content.query.scope, ...scope } } } }
}

/** Destination metadata is validated before admission. Record reads still occur in data steps. */
export async function validateWorkflowDestination(graph: ResolvedWorkflowGraph, scope: QueryScope,
  resolve: (reference: QueryReference, inputs: Record<string, DataValue>) => Promise<unknown>): Promise<void> {
  const rootInputs = Object.fromEntries((graph.root.inputs ?? []).filter(input => input.default !== undefined).map(input => [input.name, input.default!]))
  const contexts = new Map<string, Record<string, DataValue>>()
  for (const node of graph.nodes) {
    const inputs = { ...node.defaultInputs, ...rootInputs }
    if (node.path.length > 1) {
      const parentPath = node.path.slice(0, -1)
      const parent = graph.nodes.find(item => JSON.stringify(item.path) === JSON.stringify(parentPath))
      const parentInputs = contexts.get(JSON.stringify(parentPath)) ?? rootInputs
      const step = parent?.definition.steps.find(item => (item.id ?? item.name) === node.path.at(-1))
      for (const [name, binding] of Object.entries(step?.childWorkflow?.inputs ?? {})) {
        try {
          inputs[name] = resolveDataBinding(dataBindingSchema.parse(binding), { inputs: parentInputs })
        } catch { /* Runtime record bindings are validated when their data step executes. */ }
      }
    }
    contexts.set(JSON.stringify(node.path), inputs)
    for (const step of node.definition.steps) {
    if (step.query?.kind !== 'inline' || step.query.content.query.scope.workspaceId || step.query.content.query.scope.projectId) continue
    // Portable graphs forward named connection inputs unchanged through every exported child.
    for (const input of node.definition.inputs ?? []) if (input.connection) {
      if (typeof inputs[input.name] !== 'string' || !inputs[input.name]) throw new Error(`Select ${input.label ?? input.name} on this Node before running`)
    }
    const reference = structuredClone(step.query)
    const unavailable = new Set<string>()
    for (const [name, binding] of Object.entries(reference.bindings)) {
      try { resolveDataBinding(binding, { inputs }) } catch { unavailable.add(name) }
    }
    const content = reference.content
    for (const binding of [content.connection, ...Object.values(content.sourceParameters)]) {
      if (binding?.address.from === 'input' && unavailable.has(binding.address.name)) throw new Error(`Destination scope parameter ${binding.address.name} requires a value before this workflow can run`)
    }
    const knownPredicate = (predicate: DataPredicate): DataPredicate | undefined => {
      if (predicate.kind === 'comparison') return predicate.right?.address.from === 'input' && unavailable.has(predicate.right.address.name) ? undefined : predicate
      const predicates = predicate.predicates.map(knownPredicate).filter((item): item is DataPredicate => !!item)
      return predicates.length ? { ...predicate, predicates } : undefined
    }
    content.query.predicate = content.query.predicate ? knownPredicate(content.query.predicate) : undefined
    for (const name of unavailable) {
      delete reference.bindings[name]
      delete content.parameters.properties?.[name]
    }
    content.parameters.required = content.parameters.required?.filter(name => !unavailable.has(name))
    await resolve(destinationQuery(reference, scope), inputs)
    }
  }
}
