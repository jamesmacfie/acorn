// The preview plugin's node part (docs/plugins.md § The plugin API).
//
// This is the smallest NodePlugin in the tree because preview is mostly an Electron-main feature:
// the pane is a WebContentsView and the CDP driver lives in main/. This plugin is one of three
// packages outside apps/desktop that import electron lazily, the runtime escape hatch
// docs/architecture-overview.md § Package boundaries describes (tools/arch/boundaries.test.ts
// enumerates the three). Its only node-side surface is one capability: reading a task's
// browser_rules.
//
// That read needs core's tasks and projects tables, so it takes CoreServices rather than the
// database handle the composition root used to pass to a loose previewRulesForTask function in
// service/runtime.ts. It briefly owned the six browser_* agent tools too; those left for
// `plugins/browser`, whose driver is Playwright on the node rather than CDP in a desktop shell
// (docs/future/tauri/webviews-and-frames.md § Agent browser automation).
//
// No database, no routes, no dispose: there is nothing to release. It is not `required`: a node with
// preview disabled reports no page rules, which the pane already treats as an empty rule set.
import type { NodePlugin } from '@acorn/plugin-api/node'
import { PREVIEW_RULES } from '../contract/rules'
import { previewRulesForTask } from '../server/previewRules'

export const previewPlugin = (): NodePlugin => ({
  name: 'preview',
  init: (ctx) => {
    ctx.capabilities.provide(PREVIEW_RULES, { forTask: (taskId) => previewRulesForTask(ctx.core, taskId) })
  },
})
