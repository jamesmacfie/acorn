// The six `browser_*` agent tools (docs/agent-tools.md), owned by the plugin whose engine they drive.
//
// They sat in apps/node/src/wiring/agentToolsWiring.ts through Phase 2, and the blocker recorded there was
// specific: "browser_* belong to plugins/preview, which has NO node-side part at all: previewService.ts and
// browserService.ts import `electron` and run in Electron MAIN, and the driver arrives here as an injected
// DesktopCapability. Converting it is not a tool move, it is a process-boundary change."
//
// That blocker is closed, and note WHAT closed it, because the distinction matters: the process boundary did
// not move. The driver still runs in Electron main and still arrives as an injected `BrowserDesktopCapability`
// — a narrow, task-addressed, serialisable surface (docs/vNext/architecture.md). What changed is that preview
// is now a NodePlugin, so there is finally a node-side OWNER to declare these against. The tools are thin
// task-addressed forwarders either way; the point of moving them is that the declaration now lives with the
// feature instead of in an app-layer file holding every unconvertible plugin's deps in one bag.
//
// `risk: 'execute'`, all six, and that is not over-classification: driving a real browser in the task's
// worktree can submit forms and trigger side effects on whatever the dev server talks to. `exposeToRenderer`
// is what puts them in the tool-permission UI, so the owner can withhold them per tool.
//
// Every handler is `scope: 'task'` and addresses the browser by `ctx.taskId` rather than by any id the agent
// supplies. That is load-bearing: a task-scoped internal token is confined to its own task on the agent-tool
// surface, and taking the target from the credential rather than the arguments is what makes that confinement
// real here (server/auth/internalTokens.ts).
import { z } from 'zod'
import type { AgentToolContribution } from '@acorn/node-core/server/agentTools/registry.ts'
import type { BrowserDesktopCapability } from '@acorn/protocol/desktopCapabilities.ts'

export function browserAgentTools(browser: BrowserDesktopCapability): AgentToolContribution[] {
  const empty = z.object({})
  return [
    {
      name: 'browser_navigate',
      description: "Navigate the task's preview browser to a URL (get it from run_status; http(s) only).",
      input: z.object({ url: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (a, ctx) => browser.navigate(ctx.taskId, (a as { url: string }).url),
    },
    {
      name: 'browser_snapshot',
      description: 'Accessibility snapshot of the current page: a compact tree with element refs (e1, e2, …) for browser_click/browser_fill.',
      input: empty,
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (_a, ctx) => browser.snapshot(ctx.taskId),
    },
    {
      name: 'browser_click',
      description: 'Click an element by its snapshot ref.',
      input: z.object({ ref: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (a, ctx) => browser.click(ctx.taskId, (a as { ref: string }).ref),
    },
    {
      name: 'browser_fill',
      description: 'Fill a textbox by its snapshot ref (replaces the current value).',
      input: z.object({ ref: z.string(), text: z.string() }),
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (a, ctx) => {
        const { ref, text } = a as { ref: string; text: string }
        return browser.fill(ctx.taskId, ref, text)
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Screenshot the current page (png data URI).',
      input: empty,
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (_a, ctx) => browser.screenshot(ctx.taskId),
    },
    {
      name: 'browser_console',
      description: "The page's recent console output.",
      input: empty,
      scope: 'task',
      risk: 'execute',
      exposeToRenderer: true,
      handler: async (_a, ctx) => browser.console(ctx.taskId),
    },
  ]
}
