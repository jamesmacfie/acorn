import { datasetWriteSchema, type DatasetWrite } from '@acorn/protocol/datasets.ts'
import type { AppDatabase } from '../db'
import { loadTask, projectForTask } from '../worktrees/taskWorktree'
import { DatasetError, assertDatasetWriteScope, getDataset, writeDatasetRows } from './store'

/** The task ID, rather than caller JSON, determines the only workspace a workflow may write. */
export async function writeWorkflowDataset(db: AppDatabase, taskId: string, proposed: DatasetWrite): Promise<number> {
  const input = datasetWriteSchema.parse(proposed)
  const task = await loadTask(db, taskId)
  const project = task ? await projectForTask(db, task) : null
  if (!project) throw new DatasetError('forbidden', 'Workflow task has no project.')
  const dataset = getDataset(db, input.datasetId)
  assertDatasetWriteScope(dataset, project.workspaceId, project.id)
  if (dataset.feeder !== 'workflow') throw new DatasetError('forbidden', 'Dataset does not accept workflow rows.')
  return writeDatasetRows(db, dataset, input)
}
