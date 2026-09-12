// preview.rules: the browser page rules configured for a task's repo.
//
// A capability rather than a route (docs/plugins.md § Collaboration rules): the consumer is the
// service protocol's previewRules(taskId) method, called from the desktop helper, not from the
// client over HTTP. The composition root resolves this capability to fill that method. It answers
// [] when preview is disabled, which the browser automation already treats as "no rules configured".
import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'

export type PreviewRulesCapability = {
  forTask(taskId: string): Promise<PreviewBrowserRule[]>
}

export const PREVIEW_RULES = capabilityId<PreviewRulesCapability>('preview.rules')
