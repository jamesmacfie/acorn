// The acorn MCP server (docs/mcp.md, docs/agent-tools.md): a stdio server that PROJECTS the app's
// agent-tool registry. It holds no tool definitions of its own — it fetches the manifest
// (GET /api/tasks/:id/tools) and proxies every call (POST /api/tasks/:id/tools/:name) over the
// loopback API with the per-run internal bearer (see ./api.ts). One generic proxy replaces the 25
// hand-written tool bodies; the registry (server/agentTools) is the single source of truth for
// names, schemas, risk and availability.
//
// Launched by the AGENT (registered user-wide via `claude mcp add …` with the Electron-as-node
// launcher over ./main.ts), so it scopes itself from inherited env: ACORN_TASK_ID (which task) plus
// the loopback client's ACORN_API_URL/ACORN_API_TOKEN. Outside a task session, or with acorn not
// running, tools/list is empty and a call returns a structured 'no-active-task' / 'acorn-not-running'
// result — never a protocol error (a plain terminal loads this server too).
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { apiGet, apiSend } from './api'

const TASK_ID = process.env.ACORN_TASK_ID ?? ''

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })
const NO_TASK = text({ status: 'no-active-task', hint: 'This session was not launched from an acorn task — task-scoped tools need ACORN_TASK_ID.' })

type ManifestTool = { name: string; description: string; inputSchema: Record<string, unknown> }

// Fetch the currently-available tools from the registry projection. No task / acorn down / API error
// → empty list (a plain terminal shows no acorn tools; they appear once a task session connects).
async function fetchManifest(): Promise<ManifestTool[]> {
  if (!TASK_ID) return []
  const res = await apiGet(`/api/tasks/${TASK_ID}/tools`)
  if (!res.ok) return []
  return ((res.data as { tools?: ManifestTool[] }).tools ?? []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
}

export function buildServer(): Server {
  const server = new Server(
    { name: process.env.ACORN_MCP_NAME ?? 'acorn', version: '0.1.0' },
    { capabilities: { tools: { listChanged: true } } },
  )

  // Always live: re-read the manifest each list so dynamic availability (run_* appearing when a repo
  // gains run targets, a permission toggle hiding a tier) is reflected without process restart.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await fetchManifest() }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (!TASK_ID) return NO_TASK
    const res = await apiSend('POST', `/api/tasks/${TASK_ID}/tools/${encodeURIComponent(req.params.name)}`, req.params.arguments ?? {})
    if (!res.ok) return text({ status: res.kind, detail: res.detail })
    return text(res.data)
  })

  return server
}

export async function main(): Promise<void> {
  const server = buildServer()
  await server.connect(new StdioServerTransport())

  // Availability watch (Phase 4: emit tools/list_changed when the set changes mid-session). A poll,
  // not a push channel — the MCP process has only the loopback API. ponytail: 10s poll; a push
  // channel only if list-change latency ever matters.
  if (TASK_ID) {
    let seen = (await fetchManifest().catch(() => [])).map((t) => t.name).sort().join(',')
    const timer = setInterval(async () => {
      const now = (await fetchManifest().catch(() => [])).map((t) => t.name).sort().join(',')
      if (now !== seen) {
        seen = now
        await server.sendToolListChanged().catch(() => {})
      }
    }, 10_000)
    timer.unref?.()
  }
}
