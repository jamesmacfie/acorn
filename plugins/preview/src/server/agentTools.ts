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
