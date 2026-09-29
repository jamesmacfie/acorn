// Settings' test button: connect to one server the way an agent would, list its tools, disconnect
// (docs/mcp.md § Your own servers).
//
// The node asks the server itself, so the answer is the same whichever harness the server is for.
// It says whether the command starts or the URL answers and what the server offers, not what any one
// running session has connected to.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { homedir } from 'node:os'
import { safeProviderMessage } from './drivers/diagnostics'
import type { AgentDriverMcpServer } from './drivers/types'
import type { AgentMcpProbeResult } from '../shared/mcpServers'

// Long enough for `npx` to fetch a package on a cold cache, which is the usual slow first start.
const PROBE_TIMEOUT_MS = 30_000
// The tail of a failing server's stderr is usually the reason. The tail, because the start of it is
// often a banner.
const MAX_STDERR = 2_000

export async function probeMcpServer(
  server: AgentDriverMcpServer,
  secrets: readonly string[],
): Promise<AgentMcpProbeResult> {
  let stderr = ''
  const transport = server.transport === 'stdio'
    ? new StdioClientTransport({
      command: server.command,
      args: server.args,
      // The SDK adds PATH, HOME and the rest of a minimal login environment underneath this.
      env: server.env,
      // No task is in reach from Settings, so the server starts where a new terminal would.
      cwd: homedir(),
      stderr: 'pipe',
    })
    : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
  if (transport instanceof StdioClientTransport) {
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR)
    })
  }
  const client = new Client({ name: 'acorn-settings', version: '1.0.0' })
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`No answer after ${PROBE_TIMEOUT_MS / 1000} seconds.`)), PROBE_TIMEOUT_MS)
    })
    const listed = await Promise.race([
      client.connect(transport).then(() => client.listTools()),
      timeout,
    ])
    return {
      ok: true,
      tools: listed.tools.map((tool) => ({ name: tool.name, description: tool.description ?? null })),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const detail = stderr.trim() ? `${message}\n${stderr.trim()}` : message
    return { ok: false, error: safeProviderMessage(detail, 'The server did not answer.', secrets) }
  } finally {
    clearTimeout(timer)
    await client.close().catch(() => undefined)
  }
}
