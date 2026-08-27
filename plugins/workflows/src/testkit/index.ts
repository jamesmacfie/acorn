// The test seam for this package (docs/architecture-overview.md § Package boundaries).
//
//   apps/node/test/integration/workflowFiles.test.ts    loadWorkflowFiles, normalizePersistedWorkflow
//   apps/node/test/integration/workflowRunner.test.ts   the runner and its schema tables
export { loadWorkflowFiles } from '../main/workflowFiles'
export { normalizePersistedWorkflow } from '../main/workflowValidation'
export { WorkflowRunner, type RunnerDeps, type WorkflowDef } from '../main/workflowRunner'
export { workflowRuns, workflowSteps } from '../node/schema'
