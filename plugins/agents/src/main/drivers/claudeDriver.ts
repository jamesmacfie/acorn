import {
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
  type ContentBlock,
  type RequestPermissionResponse,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Readable, Writable } from 'node:stream'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { brokerEnv } from '@acorn/plugin-api/node'
import { AGENT_TOOL_PASSTHROUGH } from './toolEnv'
import type { AgentInputPart, AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import { resolveUsageCommand, usageProcessEnv } from '../usage/processRunner'
import { normalizeAcpConfig, normalizeAcpPermission, normalizeAcpUpdate } from './acpNormalizer'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions, AgentDriverTurnOptions } from './types'
import { probeClaudeAuthentication } from './authProbe'
import { providerStderrNotice } from './diagnostics'

const nodeRequire = createRequire(import.meta.url)
const DRIVER_VERSION = 'claude-acp-1'

type PendingPermission = {
  resolve(response: RequestPermissionResponse): void
}

const adapterEntry = (): string =>
  nodeRequire.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')

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
      for (const event of normalizeAcpUpdate(params.update)) await options.onEvent(event)
    },
  }
}

export class ClaudeAgentDriver implements AgentDriver {
  readonly providerId = 'claude'
  readonly profileId = 'claude-code'

  async probe(): Promise<AgentProviderDescriptor> {
    const executable = resolveUsageCommand('claude', usageProcessEnv())
    let adapterAvailable = true
    try {
      adapterEntry()
    } catch {
      adapterAvailable = false
    }
    return {
      id: this.providerId,
      profileId: this.profileId,
      label: 'Claude Code',
      driverKind: 'acp',
      driverVersion: DRIVER_VERSION,
      installed: executable != null && adapterAvailable,
      authenticated: executable ? await probeClaudeAuthentication(executable) : null,
      executable: executable ?? undefined,
      statusAuthority: 'protocol',
      capabilities: [
        'streaming_messages',
        'reasoning',
        'tool_calls',
        'plans',
        'permissions',
        'models',
        'modes',
        'permission_policies',
        'commands',
        'usage',
        'resume',
        'file_changes',
        'attachments',
      ],
      configOptions: [],
      commands: [],
      skills: [],
      diagnostics: [
        ...(executable ? [] : ['claude is not available on PATH.']),
        ...(adapterAvailable ? [] : ['The packaged Claude ACP adapter is unavailable.']),
      ],
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    const descriptor = await this.probe()
    if (!descriptor.executable) throw new Error('Claude Code is not available on PATH.')
    await options.onEvent({
      type: 'session_state',
      state: options.session.providerSessionRef ? 'replaying' : 'connecting',
    })

    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [adapterEntry()], {
      cwd: options.cwd,
      // brokerEnv, not `{ ...process.env }`. Spreading the parent environment would hand the session
      // the node's own bindings too, SESSION_ENC_KEY, INTERNAL_TOKEN, GITHUB_CLIENT_*, on top of the
      // task env it already has (docs/security.md § Credential handling). Config directories pass
      // through by name instead.
      //
      // Not 'ANTHROPIC_*': that glob would carry ANTHROPIC_API_KEY. proc.ts's passthrough contract
      // is for tool configuration, never credentials; the CLI authenticates through its own stored
      // login under XDG_CONFIG_HOME.
      env: {
        ...brokerEnv({ env: options.env, passthrough: [...AGENT_TOOL_PASSTHROUGH, 'CLAUDE_CODE_*'] }),
        ELECTRON_RUN_AS_NODE: '1',
        CLAUDE_CODE_EXECUTABLE: descriptor.executable,
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (chunk.byteLength) {
        void options.onEvent({
          type: 'diagnostic',
          level: 'warning',
          message: providerStderrNotice('Claude ACP adapter', chunk.byteLength),
        })
      }
    })
    child.on('error', (error) => void options.onClosed(error))
    child.on('exit', (code) => void options.onClosed(
      code === 0 ? undefined : new Error(`Claude ACP adapter exited with code ${code ?? 'unknown'}.`),
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
      return clientFor(options, pending, () => replaying)
    }, stream)

    const initialized = await agent.initialize({
      protocolVersion: 1,
      clientInfo: { name: 'acorn', version: '0.1.0' },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        session: { configOptions: {} },
      },
    })
    const supportsLoad = initialized.agentCapabilities?.loadSession === true && typeof agent.loadSession === 'function'

    let providerSessionRef = options.session.providerSessionRef
    let configOptions: readonly SessionConfigOption[] = []
    if (providerSessionRef && supportsLoad) {
      const loaded = await agent.loadSession!({
        sessionId: providerSessionRef,
        cwd: options.cwd,
        additionalDirectories: [],
        mcpServers: [],
      })
      configOptions = loaded?.configOptions ?? []
    } else {
      const created = await agent.newSession({
        cwd: options.cwd,
        additionalDirectories: [],
        mcpServers: [],
      })
      providerSessionRef = created.sessionId
      configOptions = created.configOptions ?? []
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
    return {
      get providerSessionRef() {
        return providerSessionRef
      },
      get ready() {
        return !active && !stopped
      },
      async sendTurn(turnOptions: AgentDriverTurnOptions) {
        if (!providerSessionRef) throw new Error('Claude ACP session is not initialized.')
        if (active) throw new Error('Claude session already has an active turn.')
        active = true
        try {
          const response = await agent.prompt({
            sessionId: providerSessionRef,
            prompt: acpPrompt(turnOptions.input, turnOptions.attachments),
          })
          await options.onEvent({ type: 'turn_completed', stopReason: response.stopReason })
          return {}
        } catch (error) {
          await options.onEvent({
            type: 'error',
            code: 'claude_turn_failed',
            message: error instanceof Error ? error.message : 'Claude turn failed.',
            retryable: false,
          })
          throw error
        } finally {
          active = false
        }
      },
      async cancel() {
        if (!providerSessionRef || !active) return
        await agent.cancel({ sessionId: providerSessionRef })
        for (const request of pending.values()) request.resolve({ outcome: { outcome: 'cancelled' } })
        pending.clear()
      },
      async resolveRequest(providerRequestId, resolution) {
        const request = pending.get(providerRequestId)
        if (!request) throw new Error('Claude permission request is no longer pending.')
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
