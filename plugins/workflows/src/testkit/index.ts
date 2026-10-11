// The test seam for this package (docs/architecture/packages.md § Package boundaries). The node app's
// plugin integration tests reach the file loader, the runner, and its schema tables through it.
export { loadWorkflowFiles } from '../server/definitions/files'
export { WorkflowRunner, type RunnerDeps, type WorkflowDef } from '../server/runs/runner'
export { inlinePrompt } from '../server/runs/deps'
export { WorkflowDispatcher } from '../server/dispatch/dispatcher'

export { createPublishedDef } from './publishedDefinition'
export { generateWorkflowRequest } from '../server/authoring/generationRequest'
export { catalogValidation } from '../server/authoring/generate'
export { resolveWorkflowGraph } from '../server/definitions/resolution'
export type { WorkflowCatalog } from '../shared/workflowContracts'
export { WORKFLOW_POLICY, WORKFLOW_STEP_KIND, WORKFLOW_TRIGGER } from '../contract/extensions'
// Re-exported rather than imported from @acorn/plugin-api: apps/node's test tier does not depend on
// the plugin API package, and a testkit exists so it does not have to.
export type { Extension } from '@acorn/plugin-api/node'
export { workflowDispatches, workflowRuns, workflowSteps } from '../node/schema'
