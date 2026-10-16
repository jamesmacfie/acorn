import { defineDerivedSource, field, type InputRecord } from 'acorn-plugin-sdk/data'

// #region rules
// How far a task's work has shipped: the furthest environment with a succeeded deploy.
function stageOf(deploys: InputRecord[]): 'production' | 'staging' | 'none' {
  const shipped = deploys.filter((deploy) => deploy.data.status === 'succeeded')
  if (shipped.some((deploy) => deploy.data.environment === 'production')) return 'production'
  if (shipped.some((deploy) => deploy.data.environment === 'staging')) return 'staging'
  return 'none'
}
// #endregion

// #region source
export const source = defineDerivedSource({
  id: 'acme-readiness',
  name: 'Acme release readiness',
  singular: 'Task',
  plural: 'Tasks',
  handler: '/v1/p/acme-readiness/source',
  // Acorn reads these for you, with the accounts the person picks for each panel.
  inputs: {
    tasks: { source: 'core:tasks', label: 'Tasks' },
    deploys: { source: 'acme-data:deploys', label: 'Acme deploys' },
  },
  fields: {
    title: field.text({ label: 'Task', role: 'title' }),
    stage: field.choice({
      label: 'Shipped to',
      role: 'status',
      choices: [
        { id: 'none', label: 'Not deployed', tone: 'muted', rank: 0 },
        { id: 'staging', label: 'Staging', tone: 'warn', rank: 1 },
        { id: 'production', label: 'Production', tone: 'ok', rank: 2 },
      ],
    }),
    deploys: field.number({ label: 'Deploys' }),
  },
  async query({ inputs }) {
    const tasks = await inputs.tasks.all()
    const deploys = await inputs.deploys.all()
    return tasks.records.map((task) => {
      const own = deploys.records.filter((deploy) => deploy.data.taskId === task.ref.recordId)
      return {
        id: task.ref.recordId,
        // Pressing the row opens the task.
        opens: task.ref,
        data: { title: String(task.data.title), stage: stageOf(own), deploys: own.length },
      }
    })
  },
})
// #endregion
