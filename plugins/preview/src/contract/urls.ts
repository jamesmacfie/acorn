import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

export type PreviewUrlSource = 'run-target' | 'config' | 'script' | 'recipe'

export type PreviewUrlState = {
  taskId: string
  url: string
  source: PreviewUrlSource
}

/** Current URL state carried by the invalidation. Nulls make removal observable without a stale read. */
export type PreviewUrlChangedEvent =
  | PreviewUrlState
  | { taskId: string; url: null; source: null }

/** The node-owned preview home for one task. `null` means no configured or running source resolves. */
export type PreviewUrlsCapability = {
  forTask(taskId: string): Promise<PreviewUrlState | null>
}

export const PREVIEW_URLS = capabilityId<PreviewUrlsCapability>('preview.urls')
