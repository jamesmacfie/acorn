import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { WorkflowDef, WorkflowDefinitionRef } from '../../shared/workflowContracts'
import type { WorkflowFileTarget } from '../../shared/workflowFileAuthoring'
import { resolveScopedWorkflowDefinition, type WorkflowResolutionScope } from '../definitions/resolution'
import { fileHash, readWorkflowFile, type WorkflowFileRoot } from './writes'
import type { WorkflowValidationCatalog } from '../validation/definition'

/** File publication checks the same confined child references that admission will resolve. */
export async function reviewFileDependencies(db: PluginDatabase, def: WorkflowDef, target: WorkflowFileTarget,
  scope: WorkflowResolutionScope, files: WorkflowFileRoot, catalog: WorkflowValidationCatalog) {
  const reused = new Map<string, string>()
  const key = (ref: WorkflowDefinitionRef) => ref.source === 'repo' ? `repo:${ref.path}` : `${ref.source}:${ref.id}`
  const walk = async (definition: WorkflowDef, chain: string[]): Promise<void> => {
    if (chain.length > 5) throw new Error('Workflow nesting exceeds four levels')
    for (const step of definition.steps) {
      if (!step.childWorkflow) continue
      const ref = step.childWorkflow.ref
      if (chain.includes(key(ref))) throw new Error('Cannot publish a cyclic workflow graph')
      const child = await resolveScopedWorkflowDefinition(db, ref, scope, catalog)
      const bindings = step.childWorkflow.inputs ?? {}
      for (const input of child.definition.inputs ?? []) if (input.required && input.default === undefined && !bindings[input.name]) throw new Error(`Bind child input ${input.name} in ${step.name} before publishing`)
      if (ref.source === target.source) {
        const path = ref.source === 'repo' ? ref.path : ref.source === 'user' ? `.acorn/workflows/${ref.id}.toml` : ''
        const text = readWorkflowFile(files, path)
        if (text === null) throw new Error(`Workflow dependency disappeared: ${path}`)
        reused.set(path, fileHash(text))
      }
      await walk(child.definition, [...chain, key(ref)])
    }
  }
  await walk(def, [target.source === 'repo' ? `repo:${target.path}` : `user:${target.path.split('/').at(-1)!.slice(0, -5)}`])
  return [...reused].map(([path, hash]) => ({ path, hash }))
}
