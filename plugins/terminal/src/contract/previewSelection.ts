import { clientCapabilityId } from '@acorn/plugin-api/client'

/**
 * The preview client provides this callback and the terminal recipe picker consumes it. The key
 * lives here to avoid a terminal -> preview package edge while preview's node half consumes
 * terminal.runTargets in the opposite direction.
 */
export type PreviewRecipeSelection = {
  set(taskId: string, url: string): Promise<void>
}

export const PREVIEW_RECIPE_SELECTION = clientCapabilityId<PreviewRecipeSelection>('preview.recipeSelection')
