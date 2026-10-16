// The MCP relays a terminal handoff needs (docs/mcp/sign-in.md). A signed-in
// server's token stays on the node, so a session continued in a terminal reaches that server through
// a relay of its own. The relay belongs to the terminal, not the session, and closes when it stops.
// Reviewed servers still go to the terminal directly, as they did before sign-in existed.
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { TerminalSessions } from '@acorn/plugin-terminal/contract/sessions.ts'
import type { AgentDriverMcpServer } from './drivers/types'
import type { McpReviewManager } from './mcpReviewManager'
import type { AgentMcpServerStore } from './mcpServerStore'

type Resolved = Awaited<ReturnType<AgentMcpServerStore['resolve']>>

/** The servers to hand the terminal, each signed-in one swapped for a relay owned by `owner`. */
export async function relayHandoffServers(
  resolved: Pick<Resolved, 'servers' | 'revisions'>,
  owner: string,
  relays: () => Promise<McpReviewManager>,
  signedFetch: (name: string, url: string) => Promise<FetchLike>,
): Promise<AgentDriverMcpServer[]> {
  return Promise.all(
    resolved.servers.map(async (server) => {
      const identity = resolved.revisions[server.name]
      if (!identity?.signIn || server.transport !== 'http') return server
      return (await relays()).prepare(server, owner, {
        revision: identity.revision,
        review: false,
        signedFetch: await signedFetch(server.name, server.url),
      })
    }),
  )
}

/** Runs `close` once the terminal stops, including a terminal that stopped before this began watching. */
export async function closeWhenStopped(
  sessions: Pick<TerminalSessions, 'onStopped' | 'list'>,
  terminalId: string,
  close: () => Promise<void>,
): Promise<void> {
  const stopWatching = sessions.onStopped((stopped) => {
    if (stopped !== terminalId) return
    stopWatching()
    void close()
  })
  if (!(await sessions.list()).some((terminal) => terminal.id === terminalId && terminal.status === 'running')) {
    stopWatching()
    await close()
  }
}
