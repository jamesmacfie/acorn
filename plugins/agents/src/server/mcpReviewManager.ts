import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { AgentDriverMcpServer } from './drivers/types'
import type { AgentMcpServer } from '../shared/mcpServers'
import { McpReviewProxy } from './mcpReviewProxy'
import type { McpCatalogue } from './mcpCatalogue'
import type { AgentMcpServerStore } from './mcpServerStore'
import { mcpReviewFindings, presentMcpTools } from './mcpReviewPresentation'

export type McpPendingReview = {
  name: string
  sessionId: string
  revision: string
  digest: string
  version: number
  tools: Record<string, unknown>[]
  previousTools: Record<string, unknown>[]
  findings: ReturnType<typeof mcpReviewFindings>
}

export class McpReviewManager {
  readonly #store: AgentMcpServerStore
  readonly #secrets: () => readonly string[]
  readonly #live = new Map<string, McpReviewProxy>()
  readonly #seen = new Map<string, McpCatalogue>()

  constructor(store: AgentMcpServerStore, secrets: () => readonly string[]) {
    this.#store = store
    this.#secrets = secrets
  }

  /**
   * Starts a relay in front of one server and returns what the harness is given instead of it.
   * `owner` is the session it serves, or a terminal handoff's own key, and `closeSession(owner)` closes
   * it. `review` gates the tools on device approval; `signedFetch` signs requests for a server with
   * sign-in. A server can have both on one relay.
   */
  async prepare(
    server: AgentDriverMcpServer,
    owner: string,
    options: { revision: string; review: boolean; signedFetch?: FetchLike },
  ): Promise<AgentDriverMcpServer> {
    const { revision } = options
    const key = `${owner}/${server.name}`
    await this.#live.get(key)?.close()
    const proxy = new McpReviewProxy(
      server,
      owner,
      revision,
      {
        ...(options.review
          ? {
              review: {
                approved: () => this.#store.approvedCatalogue(server.name, revision),
                observed: (catalogue: McpCatalogue) => {
                  this.#seen.set(key, catalogue)
                },
              },
            }
          : {}),
        closed: () => {
          if (this.#live.get(key) === proxy) this.#live.delete(key)
          this.#seen.delete(key)
        },
      },
      { signedFetch: options.signedFetch },
    )
    try {
      const declared = await proxy.listen()
      this.#live.set(key, proxy)
      return declared
    } catch (error) {
      await proxy.close()
      throw error
    }
  }

  async pending(): Promise<McpPendingReview[]> {
    const out: McpPendingReview[] = []
    for (const [key, catalogue] of this.#seen) {
      const proxy = this.#live.get(key)
      if (!proxy) continue
      const approved = await this.#store.approvedCatalogue(proxy.name, proxy.revision)
      if (!proxy.needsApproval() && approved?.digest === catalogue.digest && approved.version === catalogue.version)
        continue
      const previous = await this.#store.previousCatalogue(proxy.name)
      const tools = presentMcpTools(catalogue.tools, this.#secrets())
      out.push({
        name: proxy.name,
        sessionId: proxy.sessionId,
        revision: proxy.revision,
        digest: catalogue.digest,
        version: catalogue.version,
        tools,
        previousTools: presentMcpTools(previous?.tools ?? [], this.#secrets()),
        findings: mcpReviewFindings(tools),
      })
    }
    return out
  }

  async approve(name: string, sessionId: string, revision: string, digest: string): Promise<AgentMcpServer> {
    const proxy = this.#live.get(`${sessionId}/${name}`)
    if (!proxy || proxy.revision !== revision) throw new Error('The MCP connection changed before approval.')
    const { catalogue, generation } = await proxy.approvalSnapshot()
    if (catalogue.digest !== digest) throw new Error('The MCP catalogue changed before approval.')
    const saved = await this.#store.approveCatalogue(name, revision, catalogue)
    try {
      await proxy.announceApproval(generation, digest)
    } catch (error) {
      await this.#store.revokeCatalogue(name, revision, digest)
      throw error
    }
    return saved
  }

  async closeSession(sessionId: string): Promise<void> {
    await Promise.allSettled(
      [...this.#live.values()].filter((proxy) => proxy.sessionId === sessionId).map((proxy) => proxy.close()),
    )
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.#live.values()].map((proxy) => proxy.close()))
  }
}
