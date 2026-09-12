export const previewUrlRoute = (taskId: string): string =>
  `/v2/p/preview/tasks/${encodeURIComponent(taskId)}/url`

export const previewRecipeUrlRoute = (taskId: string): string =>
  `/v2/p/preview/tasks/${encodeURIComponent(taskId)}/recipe-url`
