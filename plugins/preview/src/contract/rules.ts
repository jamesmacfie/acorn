// preview.rules — the browser page rules configured for a task's repo
// (docs/vNext/plugins.md § Cross-plugin collaboration).
//
// This plugin is almost entirely Electron-main: the preview pane is a `WebContentsView` and its driver
// lives in main/. Its one node-side read is this — resolve a taskId to the `browser_rules` its repo
// declares — and it exists on the node because the lookup needs core's `tasks` and `repo_paths` tables and
// because ONLY serialisable rules may cross into Electron main. The native preview never receives a
// database handle and never reaches back into service modules.
//
// A capability rather than a route: the consumer is the service protocol's `previewRules(taskId)` method,
// called from Electron main over IPC, not from the renderer over HTTP. The composition root resolves this
// to fill that method, which is why it is `get`-able and answers `[]` when preview is disabled — a node
// with no preview plugin has no page rules to report, and an empty list is exactly what the browser
// automation already treats as "no rules configured".
import { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'
import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'

export type PreviewRulesCapability = {
  forTask(taskId: string): Promise<PreviewBrowserRule[]>
}

export const PREVIEW_RULES = capabilityId<PreviewRulesCapability>('preview.rules')
