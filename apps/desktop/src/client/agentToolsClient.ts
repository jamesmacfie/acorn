import { rendererAgentToolRoute } from '../shared/api'
import { writeJson } from './apiClient'

// Thin renderer projection. The server only admits contributions with exposeToRenderer=true; the
// caller supplies the contribution-owned argument/result types at its feature boundary.
export const callRendererAgentTool = <Args extends Record<string, unknown>, Result>(taskId: string, name: string, args: Args): Promise<Result> =>
  writeJson<Result>(rendererAgentToolRoute(taskId, name), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
