// preview.rules: the browser page rules configured for a task's repo.
//
// A capability rather than a route (docs/plugins.md § Collaboration rules): the consumer is the
// service protocol's previewRules(taskId) method, called from Electron main over IPC, not from the
// renderer over HTTP. The composition root resolves this capability to fill that method. It answers
// [] when preview is disabled, which the browser automation already treats as "no rules configured".
import { capabilityId } from '@acorn/plugin-api/node'
import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'

export type PreviewRulesCapability = {
  forTask(taskId: string): Promise<PreviewBrowserRule[]>
}

export const PREVIEW_RULES = capabilityId<PreviewRulesCapability>('preview.rules')
