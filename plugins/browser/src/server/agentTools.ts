import { z } from 'zod'
import type { AgentToolContribution } from '@acorn/plugin-api/node'
import type { BrowserPool } from './driver'

// The six browser tools, contributed through the agent-tool registry like any other plugin's, which is
// what projects them to MCP, the harness route and the renderer for free (docs/agent-tools.md).
//
// They kept their names and their descriptions from the version that lived in `plugins/preview`, so an
// agent's habits and a stored permission decision both survive the move. What changed underneath is
// everything: the browser is the node's now, not a desktop shell's, so a headless remote node has one
// too (docs/agent-tools.md § Browser tools).

const empty = z.object({})

export function browserAgentTools(pool: BrowserPool): AgentToolContribution[] {
  const tool = (
    name: string,
    description: string,
    input: z.ZodType,
    handler: AgentToolContribution['handler'],
  ): AgentToolContribution => ({ name, description, input, scope: 'task', risk: 'execute', exposeToRenderer: true, handler })

  return [
    tool(
      'browser_navigate',
      "Navigate the task's browser to a URL (get it from run_status; http(s) only).",
      z.object({ url: z.string() }),
      async (args, ctx) => pool.navigate(ctx.taskId, (args as { url: string }).url),
    ),
    tool(
      'browser_snapshot',
      'Accessibility snapshot of the current page: a compact tree with element refs (e1, e2, …) for browser_click/browser_fill.',
      empty,
      async (_args, ctx) => pool.snapshot(ctx.taskId),
    ),
    tool('browser_click', 'Click an element by its snapshot ref.', z.object({ ref: z.string() }), async (args, ctx) =>
      pool.click(ctx.taskId, (args as { ref: string }).ref),
    ),
    tool(
      'browser_fill',
      'Fill a textbox by its snapshot ref (replaces the current value).',
      z.object({ ref: z.string(), text: z.string() }),
      async (args, ctx) => {
        const { ref, text } = args as { ref: string; text: string }
        return pool.fill(ctx.taskId, ref, text)
      },
    ),
    tool(
      'browser_screenshot',
      // The answer is a handle, not an image, and the description says so: an agent that expected
      // pixels would otherwise report the tool broken.
      'Screenshot the current page. Returns a capture id and the node URL that serves the PNG; the bytes are stored on the node, not inlined here.',
      empty,
      async (_args, ctx) => pool.screenshot(ctx.taskId),
    ),
    tool('browser_console', "The page's recent console output.", empty, async (_args, ctx) => pool.console(ctx.taskId)),
  ]
}
