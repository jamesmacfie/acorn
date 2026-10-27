import { previewProxyRoute } from '../contract/routes'

export const previewUrlRoute = (taskId: string): string => `/v1/p/preview/tasks/${encodeURIComponent(taskId)}/url`

export const previewRecipeUrlRoute = (taskId: string): string =>
  `/v1/p/preview/tasks/${encodeURIComponent(taskId)}/recipe-url`

export const previewConfiguredRoute = '/v1/p/preview/configured'

// Asks the Node for an address a phone's browser can load, which the Node's own listener answers
// (docs/relay/phone-channel.md § Previews).
export const previewOpenRoute = (taskId: string): string => `${previewProxyRoute(taskId)}/__acorn/open`
