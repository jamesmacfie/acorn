import { brokerEnv } from '@acorn/plugin-api/node'
import { AGENT_TOOL_PASSTHROUGH } from './toolEnv'
import { execFile } from 'node:child_process'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  AgentInputPart,
  AgentProviderDescriptor,
} from '@acorn/protocol/managedAgents.ts'
import { resolveUsageCommand, usageProcessEnv } from '../usage/processRunner'
import { asObject, codexServerRequestResponse, normalizeCodexNotification, normalizeCodexServerRequest } from './codexNormalizer'
import { JsonRpcProcess, type JsonRpcServerRequest } from './jsonRpcProcess'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions, AgentDriverTurnOptions } from './types'
import { probeCodexAuthentication } from './authProbe'
import { canReplaceMissingCodexSession } from './codexSessionRecovery'
import { providerStderrNotice } from './diagnostics'
import {
  codexModelOptions,
  codexPermissionOptions,
  codexReasoningOptions,
  codexSkillsFromResponse,
} from './codexConfiguration'

const execFileAsync = promisify(execFile)
const DRIVER_VERSION = 'codex-app-server-v2'

const stringValue = (value: unknown): string | null => typeof value === 'string' ? value : null

async function executableVersion(executable: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ['--version'], { timeout: 3_000, encoding: 'utf8' })
    return (stdout || stderr).trim().split(/\r?\n/)[0] || undefined
  } catch {
    return undefined
  }
}

function codexInput(
  parts: AgentInputPart[],
  cwd: string,
  attachments: AgentDriverTurnOptions['attachments'],
): Record<string, unknown>[] {
  const input: Record<string, unknown>[] = []
  for (const part of parts) {
    switch (part.type) {
      case 'text':
        input.push({ type: 'text', text: part.text, text_elements: [] })
        break
      case 'context':
        input.push({
          type: 'text',
          text: `<acorn-context source="${part.source}" label="${part.label}">\n${part.content}\n</acorn-context>`,
          text_elements: [],
        })
        break
      case 'file': {
        const path = resolve(cwd, part.path)
        input.push({ type: 'mention', name: basename(part.path), path })
        break
      }
      case 'attachment':
      case 'image': {
        const attachment = attachments[part.attachmentId]
        if (!attachment) throw new Error(`Attachment is unavailable: ${part.attachmentId}`)
        if (attachment.mediaType.startsWith('image/')) {
          input.push({ type: 'localImage', path: attachment.localPath })
        } else {
          input.push({ type: 'mention', name: attachment.filename, path: attachment.localPath })
        }
        break
      }
    }
  }
  return input
}

export class CodexAgentDriver implements AgentDriver {
  readonly providerId = 'codex'
  readonly profileId = 'codex'

  async probe(): Promise<AgentProviderDescriptor> {
    const env = usageProcessEnv()
    const executable = resolveUsageCommand('codex', env)
    return {
      id: this.providerId,
      profileId: this.profileId,
      label: 'Codex',
      driverKind: 'codex-app-server',
      driverVersion: DRIVER_VERSION,
      installed: executable != null,
      authenticated: executable ? await probeCodexAuthentication(executable) : null,
      executable: executable ?? undefined,
      executableVersion: executable ? await executableVersion(executable) : undefined,
      statusAuthority: 'protocol',
      capabilities: [
        'streaming_messages',
        'reasoning',
        'tool_calls',
        'plans',
        'permissions',
        'questions',
        'elicitations',
        'models',
        'reasoning_levels',
        'permission_policies',
        'skills',
        'usage',
        'resume',
        'fork',
        'compact',
        'archive',
        'delete',
        'file_changes',
        'subagents',
        'attachments',
      ],
      configOptions: [],
      commands: [],
      skills: [],
      diagnostics: executable ? [] : ['codex is not available on PATH.'],
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    const descriptor = await this.probe()
    if (!descriptor.executable) throw new Error('Codex is not available on PATH.')
    await options.onEvent({
      type: 'session_state',
      state: options.session.providerSessionRef ? 'replaying' : 'connecting',
    })

    let threadId = options.session.providerSessionRef
    let currentTurnId: string | null = null
    let ready = false
    const pendingRequests = new Map<string, JsonRpcServerRequest>()
    let rpc!: JsonRpcProcess

    const onServerRequest = (request: JsonRpcServerRequest): void => {
      const event = normalizeCodexServerRequest(request)
      if (!event || event.type !== 'request') {
        rpc.respondError(request.id, -32601, `Acorn does not implement server request ${request.method}.`)
        return
      }
      pendingRequests.set(event.requestId, request)
      void options.onEvent(event)
    }

    rpc = new JsonRpcProcess({
      command: descriptor.executable,
      args: ['app-server', '--stdio'],
      cwd: options.cwd,
      // brokerEnv, not `{ ...process.env }` — the same leak claudeDriver was converted for, and
      // missed here. The service is spawned with the parent's environment and reads SESSION_ENC_KEY from
      // it, so spreading process.env handed every Codex session the master encryption key: with that plus
      // owner-level filesystem access to core.sqlite an agent decrypts every stored provider credential
      // directly, bypassing canUseProviderCredential and SecretService entirely.
      env: brokerEnv({ env: options.env, passthrough: [...AGENT_TOOL_PASSTHROUGH, 'CODEX_*'] }),
      onNotification: (notification) => {
        const events = normalizeCodexNotification(notification)
        for (const event of events) {
          if (event.type === 'session_state') ready = event.state === 'ready'
          if (event.type === 'turn_completed' || event.type === 'error') currentTurnId = null
          void options.onEvent(event)
        }
      },
      onRequest: onServerRequest,
      onStderr: (line) => void options.onEvent({
        type: 'diagnostic',
        level: 'warning',
        message: providerStderrNotice('Codex app-server', Buffer.byteLength(line, 'utf8')),
      }),
      onClosed: (error) => void options.onClosed(error),
    })

    await rpc.request('initialize', {
      clientInfo: { name: 'acorn', version: '0.1.0' },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: true,
      },
    })
    rpc.notify('initialized')

    const startThread = () => rpc.request<Record<string, unknown>>('thread/start', {
      cwd: options.cwd,
      runtimeWorkspaceRoots: [options.cwd],
      threadSource: 'appServer',
      ephemeral: false,
    }, 60_000)
    let sessionResponse: Record<string, unknown>
    try {
      if (threadId) {
        try {
          sessionResponse = await rpc.request<Record<string, unknown>>('thread/resume', {
            threadId,
            cwd: options.cwd,
            runtimeWorkspaceRoots: [options.cwd],
            excludeTurns: false,
          }, 60_000)
        } catch (error) {
          if (!canReplaceMissingCodexSession(error, options.noProviderExecutionHistory)) throw error
          await options.onEvent({
            type: 'diagnostic',
            level: 'warning',
            message: 'Codex had not persisted this empty thread; Acorn replaced it before dispatching queued work.',
          })
          threadId = null
          sessionResponse = await startThread()
        }
      } else {
        sessionResponse = await startThread()
      }
    } catch (error) {
      await rpc.stop()
      throw error
    }
    const thread = asObject(sessionResponse.thread)
    threadId = stringValue(thread?.id)
    if (!threadId) {
      await rpc.stop()
      throw new Error('Codex did not return a thread id.')
    }

    const [models, permissionProfiles, skills] = await Promise.all([
      rpc.request('model/list', { limit: 100, includeHidden: false }).catch(() => null),
      rpc.request('permissionProfile/list', { cwd: options.cwd, limit: 100 }).catch(() => null),
      rpc.request('skills/list', { cwds: [options.cwd], forceReload: false }).catch(() => null),
    ])
    const activePermission = asObject(sessionResponse.activePermissionProfile)
    const configOptions = [
      ...codexModelOptions(models, stringValue(sessionResponse.model)),
      ...codexReasoningOptions(
        models,
        stringValue(sessionResponse.model),
        stringValue(sessionResponse.reasoningEffort),
      ),
      ...codexPermissionOptions(permissionProfiles, stringValue(activePermission?.id)),
    ]
    await options.onEvent({
      type: 'session_metadata',
      providerSessionRef: threadId,
      configOptions,
      skills: codexSkillsFromResponse(skills),
    })
    ready = true
    await options.onEvent({ type: 'session_state', state: 'ready' })

    return {
      get providerSessionRef() {
        return threadId
      },
      get ready() {
        return ready && currentTurnId == null && !rpc.closed
      },
      async sendTurn(turnOptions: AgentDriverTurnOptions) {
        if (!threadId) throw new Error('Codex thread is not initialized.')
        if (!ready || currentTurnId) throw new Error('Codex session is not ready for another turn.')
        ready = false
        const result = await rpc.request<Record<string, unknown>>('turn/start', {
          threadId,
          clientUserMessageId: turnOptions.turn.id,
          input: codexInput(turnOptions.input, options.cwd, turnOptions.attachments),
          cwd: options.cwd,
          ...(turnOptions.turn.effectivePolicy.model ? { model: turnOptions.turn.effectivePolicy.model } : {}),
          ...(turnOptions.turn.effectivePolicy.effort ? { effort: turnOptions.turn.effectivePolicy.effort } : {}),
          ...(turnOptions.turn.effectivePolicy.permissions ? { permissions: turnOptions.turn.effectivePolicy.permissions } : {}),
        })
        const turn = asObject(result.turn)
        currentTurnId = stringValue(turn?.id)
        return { providerTurnRef: currentTurnId ?? undefined }
      },
      async cancel() {
        if (!threadId || !currentTurnId) return
        await rpc.request('turn/interrupt', { threadId, turnId: currentTurnId }).catch(() => undefined)
      },
      async resolveRequest(providerRequestId, resolution) {
        const request = pendingRequests.get(providerRequestId)
        if (!request) throw new Error('Codex request is no longer pending.')
        pendingRequests.delete(providerRequestId)
        rpc.respond(request.id, codexServerRequestResponse(request, resolution))
      },
      async setConfig(optionId, value) {
        if (optionId === 'model') {
          return configOptions.map((option) => option.id === optionId ? { ...option, currentValue: value } : option)
        }
        return configOptions.map((option) => option.id === optionId ? { ...option, currentValue: value } : option)
      },
      async compact() {
        if (!threadId) return
        await rpc.request('thread/compact/start', { threadId }, 60_000)
      },
      async fork() {
        if (!threadId) throw new Error('Codex thread is not initialized.')
        if (currentTurnId) throw new Error('Finish or cancel the active Codex turn before forking.')
        const response = await rpc.request<Record<string, unknown>>('thread/fork', {
          threadId,
          cwd: options.cwd,
          runtimeWorkspaceRoots: [options.cwd],
          threadSource: 'appServer',
          excludeTurns: true,
        }, 60_000)
        const forked = asObject(response.thread)
        const forkedId = stringValue(forked?.id)
        if (!forkedId) throw new Error('Codex did not return the forked thread id.')
        return forkedId
      },
      async archive(archived) {
        if (!threadId) throw new Error('Codex thread is not initialized.')
        await rpc.request(archived ? 'thread/archive' : 'thread/unarchive', { threadId }, 60_000)
      },
      async delete() {
        if (!threadId) throw new Error('Codex thread is not initialized.')
        await rpc.request('thread/delete', { threadId }, 60_000)
      },
      async stop() {
        ready = false
        if (threadId) await rpc.request('thread/unsubscribe', { threadId }).catch(() => undefined)
        await rpc.stop()
      },
    }
  }
}
