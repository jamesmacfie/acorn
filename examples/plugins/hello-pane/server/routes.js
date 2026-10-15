/**
 * @param {Request} request
 * @param {import('acorn-plugin-types').PluginRequestContext} context
 * @param {import('acorn-plugin-types').CoreServices} core
 */
export async function handle(request, context, core) {
  const { pathname, searchParams } = new URL(request.url)
  if (request.method !== 'GET') return new Response('not found', { status: 404 })

  // Core returns a TaskRef projection, not a database row.
  const taskId = searchParams.get('taskId')
  const task = taskId ? await core.tasks.load(taskId) : null

  // #region branch
  if (pathname === '/branch') {
    // `branch` is null for a task that runs in the project's own folder.
    return Response.json({
      text: task?.branch ? `This task works on ${task.branch}` : 'This task runs in the project folder',
    })
  }
  // #endregion

  if (pathname !== '/greeting') return new Response('not found', { status: 404 })
  return Response.json({
    text: task ? `Hello from ${task.title}` : 'Hello from the node',
    who: context.userId,
  })
}
