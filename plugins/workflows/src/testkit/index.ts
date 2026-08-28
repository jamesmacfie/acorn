// The test seam for this package (docs/architecture-overview.md § Package boundaries).
//
//   apps/node/test/integration/workflowFiles.test.ts    loadWorkflowFiles, normalizePersistedWorkflow
//   apps/node/test/integration/workflowRunner.test.ts   the runner and its schema tables
export { loadWorkflowFiles } from '../main/workflowFiles'
export { normalizePersistedWorkflow } from '../main/workflowValidation'
export { WorkflowRunner, type RunnerDeps, type WorkflowDef, type WorkflowExtensions } from '../main/workflowRunner'
export { WORKFLOW_POLICY, WORKFLOW_STEP_KIND, WORKFLOW_TRIGGER } from '../contract/extensions'
// Re-exported rather than imported from @acorn/plugin-api: apps/node's test tier does not depend on
// the plugin API package, and a testkit exists so it does not have to.
export type { Extension } from '@acorn/plugin-api/node'
export { workflowRuns, workflowSteps } from '../node/schema'
