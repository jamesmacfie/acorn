import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type Server as HttpServer } from 'node:http'
import { homedir } from 'node:os'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { AgentDriverMcpServer } from './drivers/types'
import { mcpCatalogue, type McpCatalogue } from './mcpCatalogue'

const MAX_MESSAGE_BYTES = 1024 * 1024
const DEADLINE_MS = 30_000

type Rpc = JSONRPCMessage & { id?: string | number; method?: string; params?: Record<string, unknown> }
type Approval = { revision: string; digest: string; version: number; tools: Record<string, unknown>[] }

export type McpReviewProxyPorts = {
  approved(): Promise<Approval | null>
  observed(catalogue: McpCatalogue): void
  closed(): void
}

/** A byte-limited JSON-RPC relay. It keeps the upstream transport that the harness actually reaches,
 *  and changes only tools/list and tools/call. Every other supported MCP message passes through. */
export class McpReviewProxy {
  readonly #upstream: Transport
  readonly #downstream: StreamableHTTPServerTransport
  readonly #listener: HttpServer
  readonly #token = randomBytes(32).toString('base64url')
  readonly #ports: McpReviewProxyPorts
  readonly #pending = new Map<string | number, { resolve: (message: Rpc) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  readonly #forwarded = new Map<string | number, NodeJS.Timeout>()
  #startPromise: Promise<void> | null = null
  #closed = false
  #quarantined = true
  #lastDigest: string | null = null
  #busyCatalogue: Promise<McpCatalogue> | null = null
  readonly name: string
  readonly sessionId: string
  readonly revision: string
  url = ''

  constructor(server: AgentDriverMcpServer, sessionId: string, revision: string, ports: McpReviewProxyPorts) {
    this.name = server.name
    this.sessionId = sessionId
    this.revision = revision
    this.#ports = ports
    this.#upstream = server.transport === 'stdio'
      ? new StdioClientTransport({ command: server.command, args: server.args, env: server.env, cwd: homedir(), stderr: 'pipe' })
      : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
    this.#downstream = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
    this.#upstream.onmessage = (message) => { void this.#fromUpstream(message as Rpc) }
    this.#upstream.onerror = () => { void this.close() }
    this.#upstream.onclose = () => { void this.close() }
    this.#downstream.onmessage = (message) => { void this.#fromHarness(message as Rpc) }
    this.#downstream.onclose = () => { void this.close() }
    this.#listener = createServer((req, res) => {
      const auth = req.headers.authorization ?? ''
      const expected = `Bearer ${this.#token}`
      const supplied = Buffer.from(auth)
      const wanted = Buffer.from(expected)
      if (this.#closed || supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
        res.writeHead(401).end(); return
      }
      const length = Number(req.headers['content-length'] ?? 0)
      if (length > MAX_MESSAGE_BYTES) { res.writeHead(413).end(); return }
      let bytes = 0
      req.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_MESSAGE_BYTES) req.destroy() })
      void this.#downstream.handleRequest(req, res).catch(() => { if (!res.headersSent) res.writeHead(502).end() })
    })
  }

  async listen(): Promise<AgentDriverMcpServer> {
    await new Promise<void>((resolve, reject) => {
      this.#listener.once('error', reject)
      this.#listener.listen(0, '127.0.0.1', () => { this.#listener.off('error', reject); resolve() })
    })
    const address = this.#listener.address()
    if (!address || typeof address === 'string') throw new Error('The MCP review proxy could not bind a loopback port.')
    this.url = `http://127.0.0.1:${address.port}/mcp`
    return { transport: 'http', name: this.name, url: this.url, headers: { Authorization: `Bearer ${this.#token}` } }
  }

  async #start(): Promise<void> {
    return this.#startPromise ??= this.#upstream.start()
  }

  async #send(transport: Transport, message: Rpc): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(message)) > MAX_MESSAGE_BYTES) throw new Error('An MCP message exceeded the byte limit.')
    await transport.send(message)
  }

  async #replyError(id: string | number, detail: string): Promise<void> {
    await this.#send(this.#downstream, { jsonrpc: '2.0', id, error: { code: -32000, message: detail } } as Rpc)
  }

  async #fromHarness(message: Rpc): Promise<void> {
    try {
      await this.#start()
      if (message.id !== undefined && !message.method) {
        await this.#send(this.#upstream, message)
        return
      }
      if ((message.method === 'tools/list' || message.method === 'tools/call') && message.id === undefined) return
      if (message.method === 'tools/list' && message.id !== undefined) {
        const catalogue = await this.catalogue()
        const approved = await this.#ports.approved()
        const admitted = !this.#quarantined && approved?.revision === this.revision && approved.version === catalogue.version && approved.digest === catalogue.digest
        await this.#send(this.#downstream, { jsonrpc: '2.0', id: message.id, result: { tools: admitted ? catalogue.tools : [] } } as Rpc)
        return
      }
      if (message.method === 'tools/call' && message.id !== undefined) {
        const catalogue = await this.catalogue()
        const approved = await this.#ports.approved()
        const name = message.params?.name
        if (this.#quarantined || approved?.revision !== this.revision || approved.version !== catalogue.version || approved.digest !== catalogue.digest || !approved.tools.some((tool) => tool.name === name)) {
          await this.#replyError(message.id, 'This MCP tool definition needs device review on the current connection.')
          return
        }
      }
      if (message.id !== undefined && message.method) {
        if (this.#forwarded.has(message.id)) { await this.#replyError(message.id, 'Duplicate MCP request id.'); return }
        const timer = setTimeout(() => {
          this.#forwarded.delete(message.id!)
          void this.#replyError(message.id!, 'The MCP server did not answer within 30 seconds.')
        }, DEADLINE_MS)
        this.#forwarded.set(message.id, timer)
      }
      await this.#send(this.#upstream, message)
      if (message.method === 'notifications/initialized') void this.catalogue().catch(() => undefined)
    } catch {
      if (message.id !== undefined) {
        const timer = this.#forwarded.get(message.id)
        if (timer) { clearTimeout(timer); this.#forwarded.delete(message.id) }
      }
      if (message.id !== undefined && message.method) await this.#replyError(message.id, 'The MCP review proxy could not forward this request.').catch(() => undefined)
    }
  }

  async #fromUpstream(message: Rpc): Promise<void> {
    try {
      if (message.id !== undefined && !message.method) {
        const internal = this.#pending.get(message.id)
        if (internal) {
          clearTimeout(internal.timer); this.#pending.delete(message.id); internal.resolve(message); return
        }
        const timer = this.#forwarded.get(message.id)
        if (timer) { clearTimeout(timer); this.#forwarded.delete(message.id) }
        else return // A timed-out response is no longer attached to a harness request.
      }
      if (message.method === 'notifications/tools/list_changed') {
        this.#quarantined = true
        this.#lastDigest = null
      }
      await this.#send(this.#downstream, message)
    } catch { await this.close() }
  }

  async #requestList(cursor?: string): Promise<{ tools: unknown[]; nextCursor?: string }> {
    const id = `acorn-review-${randomUUID()}`
    const response = new Promise<Rpc>((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error('The MCP catalogue did not answer within 30 seconds.')) }, DEADLINE_MS)
      this.#pending.set(id, { resolve, reject, timer })
    })
    try { await this.#send(this.#upstream, { jsonrpc: '2.0', id, method: 'tools/list', params: cursor ? { cursor } : {} } as Rpc) }
    catch (error) {
      const pending = this.#pending.get(id)
      if (pending) { clearTimeout(pending.timer); this.#pending.delete(id) }
      throw error
    }
    const answer = await response
    if ('error' in answer) throw new Error('The MCP server refused to list its tools.')
    const result = (answer as { result?: { tools?: unknown[]; nextCursor?: string } }).result
    if (!Array.isArray(result?.tools) || (result.nextCursor !== undefined && typeof result.nextCursor !== 'string')) throw new Error('The MCP server returned an invalid tool list.')
    return { tools: result.tools, nextCursor: result.nextCursor }
  }

  async catalogue(): Promise<McpCatalogue> {
    return this.#busyCatalogue ??= (async () => {
      await this.#start()
      const tools: unknown[] = []
      let cursor: string | undefined
      const seen = new Set<string>()
      for (let page = 0; page < 32; page++) {
        const result = await this.#requestList(cursor)
        tools.push(...result.tools)
        if (tools.length > 256 || Buffer.byteLength(JSON.stringify(tools)) > 256 * 1024) throw new Error('The MCP catalogue exceeded its bounds.')
        if (!result.nextCursor) {
          const catalogue = mcpCatalogue(tools)
          if (this.#lastDigest !== catalogue.digest) {
            this.#lastDigest = catalogue.digest
            this.#ports.observed(catalogue)
          }
          const approved = await this.#ports.approved()
          this.#quarantined = approved?.revision !== this.revision || approved.version !== catalogue.version || approved.digest !== catalogue.digest
          return catalogue
        }
        if (seen.has(result.nextCursor)) throw new Error('The MCP server repeated a catalogue cursor.')
        seen.add(result.nextCursor)
        cursor = result.nextCursor
      }
      throw new Error('The MCP catalogue has too many pages.')
    })().finally(() => { this.#busyCatalogue = null })
  }

  async announceApproval(): Promise<void> {
    this.#quarantined = false
    await this.#send(this.#downstream, { jsonrpc: '2.0', method: 'notifications/tools/list_changed' } as Rpc)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    for (const item of this.#pending.values()) { clearTimeout(item.timer); item.reject(new Error('The MCP proxy closed.')) }
    this.#pending.clear()
    for (const timer of this.#forwarded.values()) clearTimeout(timer)
    this.#forwarded.clear()
    try { this.#listener.close() } catch { /* A failed bind has no listener to close. */ }
    await Promise.allSettled([this.#upstream.close(), this.#downstream.close()])
    this.#ports.closed()
  }
}
