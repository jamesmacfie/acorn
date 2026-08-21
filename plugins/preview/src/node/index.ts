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
// service/runtime.ts. It also owns the six browser_* agent tools (server/agentTools.ts), moved here
// from apps/node/src/wiring/agentToolsWiring.ts now that the plugin has a node-side owner to declare
// them against; the driver itself still runs in Electron main.
//
// No database, no routes, no dispose: there is nothing to release. It is not `required`: a node
// with preview disabled reports no page rules and contributes no browser tools, which is already
// how the browser automation treats an empty rule set.
import type { NodePlugin } from '@acorn/plugin-api/node'
import type { BrowserDesktopCapability } from '@acorn/protocol/desktopCapabilities.ts'
import { PREVIEW_RULES } from '../contract/rules'
import { browserAgentTools } from '../server/agentTools'
import { previewRulesForTask } from '../server/previewRules'

export type PreviewPluginDeps = {
  // The Electron-main browser driver, task-addressed and serialisable
  // (@acorn/protocol/desktopCapabilities.ts). It stays an app-supplied dep for the same reason
  // terminal's `internalEnv` does: it is a native adapter the composition root owns, and a plugin
  // may not import electron to build one. A node with no window (dev:node) supplies a driver whose
  // calls fail cleanly.
  browser: BrowserDesktopCapability
}

export const previewPlugin = (deps: PreviewPluginDeps): NodePlugin => ({
  name: 'preview',
  init: (ctx) => {
    ctx.capabilities.provide(PREVIEW_RULES, { forTask: (taskId) => previewRulesForTask(ctx.core, taskId) })
    for (const tool of browserAgentTools(deps.browser)) ctx.tools.register(tool)
  },
})
