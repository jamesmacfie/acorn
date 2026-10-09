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
import { mcpCatalogue, type McpCatalogue } from './mcpCatalogue'

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

/** A staged managed package is tested before activation. This catalogue is informational; the
 *  review proxy still checks the separate connection the harness actually uses. */
export async function probeMcpCatalogue(server: AgentDriverMcpServer, secrets: readonly string[], signal?: AbortSignal): Promise<McpCatalogue> {
  const transport = server.transport === 'stdio'
    ? new StdioClientTransport({ command: server.command, args: server.args, env: server.env, cwd: homedir(), stderr: 'pipe' })
    : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
  const client = new Client({ name: 'acorn-package-review', version: '1.0.0' })
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The staged package did not answer within 30 seconds.')), PROBE_TIMEOUT_MS)
    })
    const cancelled = new Promise<never>((_, reject) => {
      if (!signal) return
      onAbort = () => { void client.close().catch(() => undefined); reject(signal.reason ?? new Error('The staged test was cancelled.')) }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
    return await Promise.race([(async () => {
      await client.connect(transport)
      const tools: unknown[] = []
      let cursor: string | undefined
      const seen = new Set<string>()
      for (let page = 0; page < 32; page++) {
        const listed = await client.listTools(cursor ? { cursor } : undefined)
        tools.push(...listed.tools)
        if (tools.length > 256 || Buffer.byteLength(JSON.stringify(tools)) > 256 * 1024) throw new Error('The staged package catalogue exceeds its bounds.')
        if (!listed.nextCursor) return mcpCatalogue(tools)
        if (seen.has(listed.nextCursor)) throw new Error('The staged package repeated a catalogue cursor.')
        seen.add(listed.nextCursor)
        cursor = listed.nextCursor
      }
      throw new Error('The staged package catalogue has too many pages.')
    })(), deadline, cancelled])
  } catch (error) {
    throw new Error(safeProviderMessage(error, 'The staged package did not answer.', secrets))
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    await client.close().catch(() => undefined)
  }
}
