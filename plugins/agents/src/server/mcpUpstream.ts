// The connection the node itself opens to an MCP server: Settings' test, a staged package's test, and
// the relay a session reaches. One builder, so all three reach a server the same way.
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { homedir } from 'node:os'
import type { AgentDriverMcpServer } from './drivers/types'

/** `signedFetch` is a signed-in server's fetch (AgentMcpServerStore.signedFetch), which adds its token. */
export function mcpUpstream(
  server: AgentDriverMcpServer,
  signedFetch?: FetchLike,
): StdioClientTransport | StreamableHTTPClientTransport {
  return server.transport === 'stdio'
    ? new StdioClientTransport({
        command: server.command,
        args: server.args,
        // The SDK adds PATH, HOME and the rest of a minimal login environment underneath this.
        env: server.env,
        // No task is in reach from Settings or a relay, so the server starts where a new terminal would.
        cwd: homedir(),
        stderr: 'pipe',
      })
    : new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
        ...(signedFetch ? { fetch: signedFetch } : {}),
      })
}
