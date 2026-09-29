export const previewUrlRoute = (taskId: string): string =>
  `/v1/p/preview/tasks/${encodeURIComponent(taskId)}/url`

export const previewRecipeUrlRoute = (taskId: string): string =>
  `/v1/p/preview/tasks/${encodeURIComponent(taskId)}/recipe-url`

export const previewConfiguredRoute = '/v1/p/preview/configured'
