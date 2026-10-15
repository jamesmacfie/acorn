// The `acme-data:record-deploy` workflow step. Workflows draws its form from `describe`, checks the
// fields against it, and calls `handler` with the step's `with` table already rendered.

// #region step
/**
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {(taskId: string) => void} changed
 */
export function recordDeployStep(store, changed) {
  return {
    describe: {
      label: 'Record an Acme deploy',
      description: 'Save a deploy of this task’s commit, so dashboards and the task check see it.',
      icon: 'rocket',
      fields: [
        {
          id: 'environment',
          label: 'Environment',
          type: 'select',
          required: true,
          options: [
            { value: 'staging', label: 'Staging' },
            { value: 'production', label: 'Production' },
          ],
        },
        { id: 'sha', label: 'Commit', type: 'text', required: true, templates: true, placeholder: '${steps.build.output}' },
      ],
      output: {
        description: 'The new deploy’s id and environment.',
        schema: {
          type: 'object',
          properties: { deployId: { type: 'string' }, environment: { type: 'string' } },
          required: ['deployId', 'environment'],
        },
      },
    },
    /** @param {{ run: { taskId: string }, def: { with?: Record<string, unknown> } }} step */
    async handler(step) {
      const { environment, sha } = /** @type {{ environment: string, sha: string }} */ (step.def.with)
      if (!/^[0-9a-f]{7,40}$/.test(sha)) return { status: 'failed', error: `“${sha}” isn’t a commit hash.` }
      const deployId = `d-${step.run.taskId.slice(0, 8)}-${sha.slice(0, 7)}-${environment}`
      store.add({ id: deployId, taskId: step.run.taskId, environment, status: 'succeeded', sha, at: Date.now() })
      changed(step.run.taskId)
      return { status: 'done', result: `Recorded ${environment} deploy ${deployId}`, structured: { deployId, environment } }
    },
  }
}
// #endregion
