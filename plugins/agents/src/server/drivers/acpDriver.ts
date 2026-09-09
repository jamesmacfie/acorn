// One driver for every harness that speaks the Agent Client Protocol, built from a launch spec
// rather than subclassed per provider. See docs/managed-agents.md § Harnesses.
import {
  ClientSideConnection,
  ndJsonStream,
  RequestError,
  type Agent,
  type Client,
  type ContentBlock,
  type RequestPermissionResponse,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { AGENT_TOOL_PASSTHROUGH, brokerEnv } from '@acorn/plugin-api/node'
import type { AgentInputPart, AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import { resolveUsageCommand, usageProcessEnv } from '../usage/processRunner'
import { normalizeAcpConfig, normalizeAcpPermission, normalizeAcpUpdate } from './acpNormalizer'
import { harnessCapabilities, type HarnessLaunchSpec } from './harness'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions, AgentDriverTurnOptions } from './types'
import { providerStderrNotice } from './diagnostics'

const DRIVER_VERSION = 'acp-1'

// JSON-RPC code the protocol reserves for a resource the agent cannot find. On `session/load` it means
// the session reference is dead, which is the one load failure worth recovering from.
const ACP_RESOURCE_NOT_FOUND = -32002

type PendingPermission = {
  resolve(response: RequestPermissionResponse): void
}

type Launch = {
  // The argv the child runs. For the `entry` form this is the node binary plus the resolved adapter.
  file: string
  args: string[]
  // The harness's own CLI, if it has one: the `command` itself, or the CLI an adapter drives. The auth
  // probe asks about this, and the descriptor reports it.
  executable: string | null
  env: Record<string, string>
  diagnostics: string[]
}

function acpPrompt(
  parts: AgentInputPart[],
  attachments: AgentDriverTurnOptions['attachments'],
): ContentBlock[] {
  return parts.map((part) => {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text }
      case 'context':
        return {
          type: 'text',
          text: `<acorn-context source="${part.source}" label="${part.label}">\n${part.content}\n</acorn-context>`,
        }
      case 'file':
        return {
          type: 'text',
          text: `Please use the workspace file @${part.path}${part.lineStart ? `:${part.lineStart}${part.lineEnd ? `-${part.lineEnd}` : ''}` : ''}.`,
        }
      case 'attachment':
      case 'image': {
        const attachment = attachments[part.attachmentId]
        if (!attachment) throw new Error(`Attachment is unavailable: ${part.attachmentId}`)
        return {
          type: 'resource_link',
          uri: pathToFileURL(attachment.localPath).href,
          name: attachment.filename,
          mimeType: attachment.mediaType,
          size: attachment.byteSize,
        }
      }
    }
  })
}

function clientFor(
  options: AgentDriverStartOptions,
  label: string,
  pending: Map<string, PendingPermission>,
  replaying: () => boolean,
): Client {
  return {
    async requestPermission(params) {
      const requestId = randomUUID()
      const response = new Promise<RequestPermissionResponse>((resolve) => pending.set(requestId, { resolve }))
      await options.onEvent(normalizeAcpPermission(requestId, params))
      return response
    },
    async sessionUpdate(params) {
      if (replaying()) return
      for (const event of normalizeAcpUpdate(params.update, label)) await options.onEvent(event)
    },
  }
}

export class AcpDriver implements AgentDriver {
  constructor(private readonly spec: HarnessLaunchSpec) {}

  get providerId(): string {
    return this.spec.id
  }

  get profileId(): string {
    return this.spec.profileId
  }

  // Collects the reasons a launch cannot resolve instead of throwing, so an unavailable harness shows
  // up in the Agent Center as a row with a diagnostic rather than as a failed discovery.
  private launch(): Launch {
    const processEnv = usageProcessEnv()
    const diagnostics: string[] = []
    let file: string
    let args: string[]
    let executable: string | null
    const env: Record<string, string> = { ...this.spec.env }

    if ('command' in this.spec.spawn) {
      executable = resolveUsageCommand(this.spec.spawn.command, processEnv)
      if (!executable) diagnostics.push(`${this.spec.spawn.command} is not available on PATH.`)
      file = executable ?? this.spec.spawn.command
      args = [...(this.spec.spawn.args ?? [])]
    } else {
      let adapter: string | null = null
      try {
        adapter = this.spec.spawn.entry()
      } catch {
        diagnostics.push(`The ${this.spec.label} ACP adapter is unavailable.`)
      }
      file = process.execPath
      args = [...(adapter ? [adapter] : []), ...(this.spec.spawn.args ?? [])]
      const requires = this.spec.spawn.requires
      executable = requires ? resolveUsageCommand(requires.command, processEnv) : null
      if (requires && !executable) diagnostics.push(`${requires.command} is not available on PATH.`)
      if (requires && executable) env[requires.env] = executable
      if (!adapter) file = ''
    }

    return { file, args, executable, env, diagnostics }
  }

  async probe(): Promise<AgentProviderDescriptor> {
    const launch = this.launch()
    return {
      id: this.spec.id,
      profileId: this.spec.profileId,
      label: this.spec.label,
      ...(this.spec.glyph ? { glyph: this.spec.glyph } : {}),
      driverKind: 'acp',
      driverVersion: DRIVER_VERSION,
      installed: launch.diagnostics.length === 0,
      authenticated: launch.executable && this.spec.probeAuth
        ? await this.spec.probeAuth(launch.executable)
        : null,
      ...(launch.executable ? { executable: launch.executable } : {}),
      statusAuthority: 'protocol',
      capabilities: harnessCapabilities(this.spec.quirks),
      configOptions: [],
      commands: [],
      skills: [],
      diagnostics: launch.diagnostics,
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    // Read the spec here, not through `this` below. The returned literal's methods rebind `this` to
    // the literal.
    const { id, label, quirks } = this.spec
    const launch = this.launch()
    if (launch.diagnostics.length > 0) throw new Error(launch.diagnostics[0])
    await options.onEvent({
      type: 'session_state',
      state: options.session.providerSessionRef ? 'replaying' : 'connecting',
    })

    const child: ChildProcessWithoutNullStreams = spawnChild(launch.file, launch.args, {
      cwd: options.cwd,
      // brokerEnv, not `{ ...process.env }`: spreading the parent environment would hand the session
      // SESSION_ENC_KEY, INTERNAL_TOKEN, and GITHUB_CLIENT_*. See docs/security.md § Credential
      // handling. A passthrough glob is for tool configuration, never for credentials, which is why
      // `ANTHROPIC_*` and `OPENAI_*` are absent from the base allowlist AGENT_TOOL_PASSTHROUGH names.
      env: {
        ...brokerEnv({
          env: options.env,
          passthrough: [...AGENT_TOOL_PASSTHROUGH, ...(this.spec.envPassthrough ?? [])],
        }),
        ...launch.env,
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // The node's log, not the transcript. An adapter writes its startup banner here, so this used to put
    // a permanent row in the reader's conversation on every spawn, saying only how many bytes it could
    // not show them. The content stays unlogged either way (docs/security.md, credential handling).
    child.stderr.on('data', (chunk: Buffer) => {
      if (chunk.byteLength) console.warn(`[agents:provider] ${providerStderrNotice(label, chunk.byteLength)}`)
    })
    child.on('error', (error) => void options.onClosed(error))
    child.on('exit', (code) => void options.onClosed(
      code === 0 ? undefined : new Error(`${label} exited with code ${code ?? 'unknown'}.`),
    ))

    const pending = new Map<string, PendingPermission>()
    let replaying = options.session.providerSessionRef != null
    let agent!: Agent
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    )
    const connection = new ClientSideConnection((remote) => {
      agent = remote
      return clientFor(options, label, pending, () => replaying)
    }, stream)

    const initialized = await agent.initialize({
      protocolVersion: 1,
      clientInfo: { name: 'acorn', version: '0.1.0' },
      // acorn declines everything ACP offers the client side. See docs/managed-agents.md § Harnesses
      // for what each one buys and why it is parked.
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        session: { configOptions: {} },
      },
    })
    const supportsLoad = initialized.agentCapabilities?.loadSession === true && typeof agent.loadSession === 'function'

    let providerSessionRef = options.session.providerSessionRef
    let configOptions: readonly SessionConfigOption[] = []
    const createSession = async (): Promise<void> => {
      const created = await agent.newSession({
        cwd: options.cwd,
        additionalDirectories: [],
        mcpServers: [],
      })
      providerSessionRef = created.sessionId
      configOptions = created.configOptions ?? []
    }
    if (providerSessionRef && supportsLoad) {
      try {
        const loaded = await agent.loadSession!({
          sessionId: providerSessionRef,
          cwd: options.cwd,
          additionalDirectories: [],
          mcpServers: [],
        })
        configOptions = loaded?.configOptions ?? []
      } catch (error) {
        // The agent no longer holds the session this row points at. Claude Code, for one, keys its
        // store by working directory, so a checkout that moved or a pruned transcript both land here.
        // Without the fallback the row's dead reference is retried on every start, the queued turn
        // never dispatches, and the session is stuck reporting provider_start_failed.
        if (!(error instanceof RequestError) || error.code !== ACP_RESOURCE_NOT_FOUND) throw error
        await createSession()
        // Say it out loud. The transcript on screen stays, but the fresh session has never seen it,
        // so a reader who is not told will read the next answer as if the agent remembered.
        await options.onEvent({
          type: 'diagnostic',
          level: 'warning',
          message: `${label} no longer has the earlier session, so it starts fresh and cannot see the conversation above.`,
        })
      }
    } else {
      await createSession()
    }
    replaying = false
    await options.onEvent({
      type: 'session_metadata',
      providerSessionRef: providerSessionRef ?? undefined,
      configOptions: normalizeAcpConfig(configOptions),
    })
    await options.onEvent({ type: 'session_state', state: 'ready' })

    let active = false
    let stopped = false
    let currentConfig = normalizeAcpConfig(configOptions)
    // ACP has one call for everything the client sends the agent, so a turn and a compaction request
    // both go through here. It emits nothing itself, because only one of the two is a turn.
    const prompt = async (blocks: ContentBlock[]): Promise<string | undefined> => {
      if (!providerSessionRef) throw new Error(`${label} has no initialized ACP session.`)
      if (active) throw new Error(`${label} already has an active turn.`)
      active = true
      try {
        return (await agent.prompt({ sessionId: providerSessionRef, prompt: blocks })).stopReason
      } finally {
        active = false
      }
    }
    return {
      get providerSessionRef() {
        return providerSessionRef
      },
      get ready() {
        return !active && !stopped
      },
      async sendTurn(turnOptions: AgentDriverTurnOptions) {
        try {
          const stopReason = await prompt(acpPrompt(turnOptions.input, turnOptions.attachments))
          await options.onEvent({ type: 'turn_completed', ...(stopReason ? { stopReason } : {}) })
          return {}
        } catch (error) {
          await options.onEvent({
            type: 'error',
            code: `${id}_turn_failed`,
            message: error instanceof Error ? error.message : `${label} turn failed.`,
            retryable: false,
          })
          throw error
        }
      },
      // ACP has no compaction call, so the `manualCompaction` quirk means the agent implements a
      // `/compact` command. Without the quirk this stays undefined and the runtime refuses the request
      // rather than sending a prompt the agent answers as prose. No `turn_completed` here: this is not
      // a turn, and one would end whatever the transcript thinks is in flight.
      ...(quirks?.manualCompaction
        ? {
          compact: async () => {
            await prompt([{ type: 'text', text: '/compact' }])
            await options.onEvent({ type: 'diagnostic', level: 'info', message: `${label} compacted the conversation.` })
          },
        }
        : {}),
      async cancel() {
        if (!providerSessionRef || !active) return
        await agent.cancel({ sessionId: providerSessionRef })
        for (const request of pending.values()) request.resolve({ outcome: { outcome: 'cancelled' } })
        pending.clear()
      },
      async resolveRequest(providerRequestId, resolution) {
        const request = pending.get(providerRequestId)
        if (!request) throw new Error(`The ${label} permission request is no longer pending.`)
        pending.delete(providerRequestId)
        const row = typeof resolution === 'object' && resolution != null ? resolution as Record<string, unknown> : {}
        const optionId = typeof row.optionId === 'string' ? row.optionId : null
        request.resolve(optionId
          ? { outcome: { outcome: 'selected', optionId } }
          : { outcome: { outcome: 'cancelled' } })
      },
      async setConfig(optionId, value) {
        if (!providerSessionRef || !agent.setSessionConfigOption) return
        const response = await agent.setSessionConfigOption({
          sessionId: providerSessionRef,
          configId: optionId,
          value,
        })
        currentConfig = normalizeAcpConfig(response.configOptions)
        await options.onEvent({ type: 'session_metadata', configOptions: currentConfig })
        return currentConfig
      },
      async stop() {
        stopped = true
        for (const request of pending.values()) request.resolve({ outcome: { outcome: 'cancelled' } })
        pending.clear()
        if (providerSessionRef && agent.closeSession) {
          await Promise.resolve(agent.closeSession({ sessionId: providerSessionRef })).catch(() => undefined)
        }
        child.stdin.end()
        if (!child.killed) child.kill()
        await connection.closed.catch(() => undefined)
      },
    }
  }
}
