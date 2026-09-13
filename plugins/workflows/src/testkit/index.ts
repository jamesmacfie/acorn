// The test seam for this package (docs/architecture-overview.md § Package boundaries).
//
//   apps/node/test/integration/workflowFiles.test.ts    loadWorkflowFiles, normalizePersistedWorkflow
//   apps/node/test/integration/plugins/workflowRunner.test.ts  the runner and its schema tables
//   apps/node/test/integration/plugins/workflowTasks.test.ts   the complete saved-child fixture
export { loadWorkflowFiles } from '../server/workflowFiles'
export { normalizePersistedWorkflow } from '../server/workflowValidation'
export { WorkflowRunner, type RunnerDeps, type WorkflowDef, type WorkflowExtensions } from '../server/workflowRunner'
export { WorkflowDispatcher } from '../server/workflowDispatch'
export { createDef } from '../server/workflowDefs'
export { generateWorkflowRequest } from '../server/generateWorkflowRequest'
export { catalogValidation } from '../server/generateWorkflow'
export { resolveWorkflowGraph } from '../server/workflowResolution'
export type { WorkflowCatalog } from '../shared/workflowContracts'
export { WORKFLOW_POLICY, WORKFLOW_STEP_KIND, WORKFLOW_TRIGGER } from '../contract/extensions'
// Re-exported rather than imported from @acorn/plugin-api: apps/node's test tier does not depend on
// the plugin API package, and a testkit exists so it does not have to.
export type { Extension } from '@acorn/plugin-api/node'
export { workflowDispatches, workflowRuns, workflowSteps } from '../node/schema'
