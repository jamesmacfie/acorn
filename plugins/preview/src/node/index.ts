// The preview plugin's node part (docs/plugins.md § The plugin API).
//
// The smallest NodePlugin in the tree, and it is small for a real reason rather than an unfinished one:
// preview is an ELECTRON-MAIN feature. The pane is a `WebContentsView`, the CDP driving lives in main/, and
// this plugin is one of only three packages outside apps/desktop allowed to import electron at all
// (tools/arch/boundaries.test.ts enumerates them). Its whole node-side surface is one read.
//
// It is a NodePlugin anyway, and that is the point of converting it: the read needs core's `tasks` and
// `projects`, and before this it was a loose function the composition root called with core's database
// handle (`previewRulesForTask(db, taskId)` in service/runtime.ts). That is exactly the shape the split
// removes — a plugin holding core's handle — so the function now takes CoreServices and the plugin
// publishes it, leaving the composition root to resolve a capability instead of wiring a query.
//
// It also owns the six `browser_*` agent tools now (server/agentTools.ts), which closes the last W6 blocker
// that could be closed: they were held in apps/node/src/wiring/agentToolsWiring.ts precisely because this
// plugin had no node-side owner to declare them against. The process boundary did NOT move to make that
// happen — the driver still runs in Electron main and still arrives as an injected capability.
//
// No database, no routes, no `dispose`: there is nothing to release. Not `required` — a node with preview
// disabled reports no page rules and contributes no browser tools, and `[]` is already the "no rules
// configured" case the browser automation handles.
import type { NodePlugin } from '@acorn/plugin-api/node'
import type { BrowserDesktopCapability } from '@acorn/protocol/desktopCapabilities.ts'
import { PREVIEW_RULES } from '../contract/rules'
import { browserAgentTools } from '../server/agentTools'
import { previewRulesForTask } from '../server/previewRules'

export type PreviewPluginDeps = {
  // The Electron-main browser driver, task-addressed and serialisable
  // (@acorn/protocol/desktopCapabilities.ts). It stays an app-supplied dep for the same reason terminal's
  // `internalEnv` does: it is a native adapter the composition root owns, and a plugin may not import
  // electron to build one. A node with no window — `dev:node` — supplies a driver whose calls fail cleanly,
  // which is the honest degraded mode for a tool that needs a real webview.
  browser: BrowserDesktopCapability
}

export const previewPlugin = (deps: PreviewPluginDeps): NodePlugin => ({
  name: 'preview',
  init: (ctx) => {
    ctx.capabilities.provide(PREVIEW_RULES, { forTask: (taskId) => previewRulesForTask(ctx.core, taskId) })
    for (const tool of browserAgentTools(deps.browser)) ctx.tools.register(tool)
  },
})
