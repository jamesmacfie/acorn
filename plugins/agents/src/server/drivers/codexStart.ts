import { AGENT_TOOL_PASSTHROUGH, brokerEnv, createLogger } from '@acorn/plugin-api/node'
import { sessionCustomAgent } from '../../shared/customAgents'
import { randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import type { AgentConfigOption, AgentInputPart } from '../../contract/wire.ts'
import { CodexChildRouter } from './codexChildRouting'
import {
  asObject,
  codexGeneratedArtifact,
  codexPermissionSubject,
  codexServerRequestResponse,
  normalizeCodexNotification,
  normalizeCodexServerRequest,
} from './codexNormalizer'
import { JsonRpcProcess, type JsonRpcServerRequest } from './jsonRpcProcess'
import type { AgentDriverSession, AgentDriverStartOptions, AgentDriverTurnOptions } from './types'
import { contextBlock } from './contextBlock'
import { canReplaceMissingCodexSession } from './codexSessionRecovery'
import { providerStderrNotice } from './diagnostics'
import { measureAgentStartup } from './startupTelemetry'
import {
  codexCollaborationModeForTurn,
  codexCollaborationModes,
  codexMcpConfig,
  codexModelOptions,
  codexOptionsWithThreadSettings,
  codexPermissionOptions,
  codexReasoningOptions,
  codexReportedMcpServers,
  codexSkillsFromResponse,
  codexThreadSettings,
  type CodexThreadSettings,
} from './codexConfiguration'

// The node's log, tagged as the provider's side of this plugin (docs/plugin-authoring/telemetry.md §
// Telemetry and logging). A module with no `ctx` in reach, so the owner is stated here.
const log = createLogger('agents:provider', 'agents')

const stringValue = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const sessionConfigValue = (options: AgentDriverStartOptions, id: string): string | null => {
  const configOptions = Array.isArray(options.session.config.configOptions) ? options.session.config.configOptions : []
  const option = configOptions.find((value) => asObject(value)?.id === id)
  return stringValue(asObject(option)?.currentValue)
}

const changedConfigLabels = (before: readonly AgentConfigOption[], after: readonly AgentConfigOption[]): string[] =>
  after.flatMap((option) => {
    const previous = before.find((candidate) => candidate.id === option.id)
    if (!previous || previous.currentValue === option.currentValue || option.currentValue == null) return []
    const value = option.values.find((candidate) => candidate.value === option.currentValue)
    return [`${option.label} changed to ${value?.label ?? option.currentValue}`]
  })

const configValuesChanged = (before: readonly AgentConfigOption[], after: readonly AgentConfigOption[]): boolean =>
  after.some((option) => before.find((candidate) => candidate.id === option.id)?.currentValue !== option.currentValue)

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
          text: contextBlock(part),
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

export async function startCodexSession(
  options: AgentDriverStartOptions,
  executable: string,
  own: (stop: () => Promise<void>) => void,
): Promise<AgentDriverSession> {
  let threadId = options.session.providerSessionRef
  const resuming = threadId != null
  let currentTurnId: string | null = null
  let managedTurnId: string | null = null
  const managedTurns = new Map<string, string>()
  const commandTurns = new Map<string, string | null>()
  // Commands Codex has started and not yet completed. One still here when its turn completes keeps
  // running past the turn, and Codex reports its output and exit later
  // (docs/managed-agents/background-commands.md).
  const openCommands = new Map<string, { id: string; providerTurnId: string | null; owner: string | null }>()
  // Codex reports a failed turn twice: an `error` notification it will not retry, then
  // `turn/completed` carrying the same error. The transcript shows it once.
  let shownTurnFailure: string | null = null
  let ready = false
  let currentModel: string | null = null
  let currentEffort: string | null = null
  let reportedMode: 'default' | 'plan' | null = null
  let latestThreadSettings: CodexThreadSettings | null = null
  let collaborationModes = codexCollaborationModes(null, null)
  let configOptions: AgentConfigOption[] = []
  let metadataReady = false
  const pendingRequests = new Map<string, JsonRpcServerRequest>()
  const childRouter = new CodexChildRouter()
  let rpc!: JsonRpcProcess
  const mcpStartup = new Map<string, { status: string; error: string | null }>()
  const mcpConfig = codexMcpConfig(options.mcpServers)

  const emit = (event: Parameters<AgentDriverStartOptions['onEvent']>[0]): void => {
    if (options.signal?.aborted) return
    try {
      void Promise.resolve(options.onEvent(event)).catch(() => undefined)
    } catch {
      /* retired callback */
    }
  }

  const onServerRequest = (request: JsonRpcServerRequest): void => {
    if (options.signal?.aborted || rpc.closed) return
    const event = normalizeCodexServerRequest(request)
    if (!event || event.type !== 'request') {
      rpc.respondError(request.id, -32601, `Acorn does not implement server request ${request.method}.`)
      return
    }
    // Our own id, not Codex's. Codex numbers its requests from 0 in every app-server process, and a
    // session starts a new process when it resumes, so its number can repeat one this session
    // already answered. The store keys a request on session and id, and would keep the old row.
    const requestId = randomUUID()
    pendingRequests.set(requestId, request)
    const subject = codexPermissionSubject(request)
    emit(
      subject
        ? {
            type: 'permission_request',
            request: { ...event, requestId },
            subject,
            open: () => pendingRequests.has(requestId) && !rpc.closed,
            respond: (resolution) => answer(requestId, resolution),
          }
        : {
            type: 'input_request',
            request: { ...event, requestId },
            open: () => pendingRequests.has(requestId) && !rpc.closed,
            respond: (resolution) => answer(requestId, resolution),
          },
    )
  }

  // The one way a parked request is answered, whether by the person through the session handle or by a
  // policy veto that may arrive before the handle exists.
  const answer = (requestId: string, resolution: unknown): void => {
    const request = pendingRequests.get(requestId)
    if (!request) throw new Error('Codex request is no longer pending.')
    // Built first: an answer the request never offered throws here, before anything is sent.
    const response = codexServerRequestResponse(request, resolution)
    pendingRequests.delete(requestId)
    rpc.respond(request.id, response)
  }

  rpc = new JsonRpcProcess({
    command: executable,
    args: ['app-server', '--stdio'],
    cwd: options.cwd,
    // brokerEnv, not `{ ...process.env }`. The service reads SESSION_ENC_KEY from its own
    // environment, so spreading process.env hands every Codex session the master encryption key.
    // With owner-level filesystem access to core.sqlite, that decrypts every stored provider
    // credential, bypassing canUseProviderCredential and SecretService.
    env: brokerEnv({ env: options.env, passthrough: [...AGENT_TOOL_PASSTHROUGH, 'CODEX_*'] }),
    onNotification: (notification) => {
      if (options.signal?.aborted || rpc.closed) return
      // Server start-up is the process's, not a thread's, so it is kept for the panel and goes no
      // further. The transcript has nothing to say about a server that finished connecting.
      if (notification.method === 'mcpServer/startupStatus/updated') {
        const params = asObject(notification.params)
        const name = stringValue(params?.name)
        if (name)
          mcpStartup.set(name, { status: stringValue(params?.status) ?? 'unknown', error: stringValue(params?.error) })
        return
      }
      // Routed before it is normalized as the session's own. A Codex subagent is a full app-server
      // thread on this same connection, so an unrouted child `turn/completed` would end the parent's
      // turn and an unrouted child status would flip the parent's state (CodexChildRouter states the
      // hazards and the capture they came from).
      const routed = childRouter.route(notification)
      if (routed.to === 'subagent') {
        for (const event of routed.events) emit(event.type === 'tool' ? { ...event, acornTurnId: null } : event)
        return
      }
      const providerTurnId =
        stringValue(notification.params.turnId) ?? stringValue(asObject(notification.params.turn)?.id)
      if (notification.method === 'turn/started' && providerTurnId && managedTurnId) {
        managedTurns.set(providerTurnId, managedTurnId)
        if (managedTurns.size > 64) managedTurns.delete(managedTurns.keys().next().value!)
      }
      if (notification.method === 'thread/settings/updated') {
        const settings = codexThreadSettings(notification.params.threadSettings)
        if (settings) {
          latestThreadSettings = settings
          reportedMode = settings.mode
          currentModel = settings.model
          currentEffort = settings.reasoningEffort
          if (metadataReady) {
            const previous = configOptions
            configOptions = codexOptionsWithThreadSettings(configOptions, settings)
            const diagnostics = changedConfigLabels(previous, configOptions)
            if (configValuesChanged(previous, configOptions)) {
              void (async () => {
                await options.onEvent({ type: 'session_metadata', configOptions })
                for (const message of diagnostics) {
                  await options.onEvent({ type: 'diagnostic', level: 'info', message })
                }
              })().catch(() => undefined)
            }
          }
        }
      }
      // Marked before the turn's end is, so the runtime keeps the card running rather than reading the
      // end of the turn as the end of the command.
      if (notification.method === 'turn/completed') {
        for (const command of openCommands.values()) {
          if (command.providerTurnId !== providerTurnId) continue
          emit({
            type: 'tool',
            tool: { id: command.id, title: '', kind: 'execute', background: true },
            acornTurnId: command.owner,
          })
        }
      }
      for (const event of normalizeCodexNotification(notification)) {
        if (event.type === 'session_state') ready = event.state === 'ready'
        if (event.type === 'turn_completed' || event.type === 'error') currentTurnId = null
        if (event.type === 'error' && !event.retryable) {
          if (event.message === shownTurnFailure) continue
          shownTurnFailure = event.message
        }
        if (event.type === 'tool' && event.tool.kind === 'execute') {
          const commandKey = `${providerTurnId ?? ''}:${event.tool.id}`
          const owner = commandTurns.has(commandKey)
            ? commandTurns.get(commandKey)!
            : providerTurnId
              ? (managedTurns.get(providerTurnId) ?? null)
              : managedTurnId
          if (notification.method === 'item/started') {
            commandTurns.set(commandKey, owner)
            if (commandTurns.size > 512) commandTurns.delete(commandTurns.keys().next().value!)
            openCommands.set(commandKey, { id: event.tool.id, providerTurnId: providerTurnId ?? null, owner })
            if (openCommands.size > 512) openCommands.delete(openCommands.keys().next().value!)
          }
          if (notification.method === 'item/completed') openCommands.delete(commandKey)
          emit({ ...event, acornTurnId: owner })
        } else emit(event)
        if (event.type === 'turn_completed' || event.type === 'error') managedTurnId = null
      }
      const generatedArtifact = codexGeneratedArtifact(notification)
      if (generatedArtifact) emit(generatedArtifact)
    },
    onRequest: onServerRequest,
    // The node's log rather than the transcript: a byte count the reader cannot act on is not part of
    // the conversation.
    onStderr: (line) => log.warn(providerStderrNotice('Codex app-server', Buffer.byteLength(line, 'utf8'))),
    onClosed: (error) => {
      ready = false
      pendingRequests.clear()
      void Promise.resolve(options.onClosed(error)).catch(() => undefined)
    },
  })

  own(() => rpc.stop())

  await measureAgentStartup(options, 'provider.initialize', () =>
    rpc.request('initialize', {
      clientInfo: { name: 'acorn', version: '1.0.0' },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: true,
      },
    }),
  )
  rpc.notify('initialized')
  // acorn's skills, as extra roots beside the person's own. Set for this process, before the thread, so
  // its first turn lists them. Codex keeps the roots in memory and writes nothing to its config. An
  // app-server without the method lists none of them, and the lifecycle then puts them all in the index.
  // See docs/managed-agents/native-skills.md § Native skills.
  if (options.skillPlugins?.length) {
    await rpc
      .request('skills/extraRoots/set', { extraRoots: options.skillPlugins.map((plugin) => join(plugin, 'skills')) })
      .catch(() => undefined)
  }

  // A custom agent's instructions, from the snapshot the session was created with. Sent on resume as
  // well as start, and unchanged, for the reason Claude's appended system prompt is.
  const instructions = [
    sessionCustomAgent(options.session.config)?.instructions,
    options.attendanceInstructions,
    typeof options.session.config.standingContext === 'string' ? options.session.config.standingContext : undefined,
  ]
    .filter(Boolean)
    .join('\n\n')
  const developerInstructions = instructions ? { developerInstructions: instructions } : {}
  const startThread = () =>
    measureAgentStartup(options, 'provider.session.create', () =>
      rpc.request<Record<string, unknown>>(
        'thread/start',
        {
          cwd: options.cwd,
          runtimeWorkspaceRoots: [options.cwd],
          threadSource: 'appServer',
          ephemeral: false,
          ...(mcpConfig ? { config: mcpConfig } : {}),
          ...developerInstructions,
        },
        60_000,
      ),
    )
  let sessionResponse: Record<string, unknown>
  try {
    if (threadId) {
      try {
        sessionResponse = await measureAgentStartup(options, 'provider.session.resume', () =>
          rpc.request<Record<string, unknown>>(
            'thread/resume',
            {
              threadId,
              cwd: options.cwd,
              runtimeWorkspaceRoots: [options.cwd],
              excludeTurns: false,
              ...(mcpConfig ? { config: mcpConfig } : {}),
              ...developerInstructions,
            },
            60_000,
          ),
        )
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
  // The router answers "is this the parent's?" by comparing against this id, so nothing counts as a
  // child until it is set. Whatever arrived during the handshake was the parent's by definition.
  childRouter.setRootThread(threadId)

  const [models, permissionProfiles, skills, modeResponse] = await Promise.all([
    measureAgentStartup(options, 'provider.models', () =>
      rpc.request('model/list', { limit: 100, includeHidden: false }),
    ).catch(() => null),
    measureAgentStartup(options, 'provider.permissions', () =>
      rpc.request('permissionProfile/list', { cwd: options.cwd, limit: 100 }),
    ).catch(() => null),
    measureAgentStartup(options, 'provider.skills', () =>
      rpc.request('skills/list', { cwds: [options.cwd], forceReload: false }),
    ).catch(() => null),
    // App-servers without this experimental endpoint reject the request. A missing response means
    // no advertised option, leaving the rest of session startup unchanged.
    measureAgentStartup(options, 'provider.modes', () => rpc.request('collaborationMode/list', {})).catch(() => null),
  ])
  const activePermission = asObject(sessionResponse.activePermissionProfile)
  currentModel = currentModel ?? stringValue(sessionResponse.model)
  currentEffort = currentEffort ?? stringValue(sessionResponse.reasoningEffort)
  const storedMode = sessionConfigValue(options, 'mode')
  collaborationModes = codexCollaborationModes(
    modeResponse,
    reportedMode ?? storedMode ?? (resuming ? null : 'default'),
  )
  configOptions = [
    ...(collaborationModes.option ? [collaborationModes.option] : []),
    ...codexModelOptions(models, currentModel),
    ...codexReasoningOptions(models, currentModel, currentEffort),
    ...codexPermissionOptions(permissionProfiles, stringValue(activePermission?.id)),
  ]
  await measureAgentStartup(options, 'provider.metadata', async () =>
    options.onEvent({
      type: 'session_metadata',
      providerSessionRef: threadId,
      configOptions,
      skills: codexSkillsFromResponse(skills),
    }),
  )
  metadataReady = true
  if (latestThreadSettings) {
    const synchronized = codexOptionsWithThreadSettings(configOptions, latestThreadSettings)
    if (configValuesChanged(configOptions, synchronized)) {
      const diagnostics = changedConfigLabels(configOptions, synchronized)
      configOptions = synchronized
      await options.onEvent({ type: 'session_metadata', configOptions })
      for (const message of diagnostics) {
        await options.onEvent({ type: 'diagnostic', level: 'info', message })
      }
    }
  }
  ready = true
  await measureAgentStartup(options, 'provider.ready', async () =>
    options.onEvent({ type: 'session_state', state: 'ready' }),
  )

  return {
    get providerSessionRef() {
      return threadId
    },
    get ready() {
      return ready && currentTurnId == null && !rpc.closed
    },
    get pid() {
      return rpc.pid
    },
    async sendTurn(turnOptions: AgentDriverTurnOptions) {
      if (!threadId) throw new Error('Codex thread is not initialized.')
      if (!ready || currentTurnId) throw new Error('Codex session is not ready for another turn.')
      ready = false
      shownTurnFailure = null
      managedTurnId = turnOptions.turn.id
      const policy = turnOptions.turn.effectivePolicy
      const collaborationMode = codexCollaborationModeForTurn(
        collaborationModes,
        policy.mode,
        policy.model ?? currentModel,
        policy.effort ?? currentEffort,
      )
      const result = await rpc.request<Record<string, unknown>>('turn/start', {
        threadId,
        clientUserMessageId: turnOptions.turn.id,
        input: codexInput(turnOptions.input, options.cwd, turnOptions.attachments),
        cwd: options.cwd,
        ...(collaborationMode
          ? { collaborationMode }
          : {
              ...(policy.model ? { model: policy.model } : {}),
              ...(policy.effort ? { effort: policy.effort } : {}),
            }),
        ...(policy.permissions ? { permissions: policy.permissions } : {}),
      })
      const turn = asObject(result.turn)
      currentTurnId = stringValue(turn?.id)
      if (currentTurnId) managedTurns.set(currentTurnId, turnOptions.turn.id)
      return { providerTurnRef: currentTurnId ?? undefined }
    },
    async cancel() {
      if (!threadId || !currentTurnId) return
      await rpc.request('turn/interrupt', { threadId, turnId: currentTurnId }).catch(() => undefined)
    },
    async cancelSubagent(subagentId) {
      if (subagentId === threadId) throw new Error('Subagent not found.')
      let turnId = childRouter.activeTurnId(subagentId)
      // A resumed connection can miss the child's turn/started notification. Read the provider's
      // turn rather than borrowing the parent's currentTurnId or restarting the child.
      if (!turnId) {
        const response = await rpc.request<Record<string, unknown>>('thread/read', {
          threadId: subagentId,
          includeTurns: true,
        })
        const turns = asObject(response.thread)?.turns
        if (!Array.isArray(turns)) throw new Error('Codex did not return the subagent turns.')
        const active = turns.map(asObject).find((turn) => turn?.status === 'inProgress')
        turnId = stringValue(active?.id)
      }
      if (turnId) await rpc.request('turn/interrupt', { threadId: subagentId, turnId })
      else await options.onEvent({ type: 'subagent', subagent: { id: subagentId, status: 'idle' } })
    },
    async resolveRequest(providerRequestId, resolution) {
      answer(providerRequestId, resolution)
    },
    async setConfig(optionId, value) {
      configOptions = configOptions.map((option) =>
        option.id === optionId ? { ...option, currentValue: value } : option,
      )
      if (optionId === 'model') currentModel = value
      if (optionId === 'reasoning') currentEffort = value
      return configOptions
    },
    async compact() {
      if (!threadId) return
      await rpc.request('thread/compact/start', { threadId }, 60_000)
    },
    async mcpStatus() {
      const response = await rpc.request(
        'mcpServerStatus/list',
        { threadId, detail: 'toolsAndAuthOnly', limit: 100 },
        15_000,
      )
      return codexReportedMcpServers(response, mcpStartup)
    },
    async fork() {
      if (!threadId) throw new Error('Codex thread is not initialized.')
      if (currentTurnId) throw new Error('Finish or cancel the active Codex turn before forking.')
      const response = await rpc.request<Record<string, unknown>>(
        'thread/fork',
        {
          threadId,
          cwd: options.cwd,
          runtimeWorkspaceRoots: [options.cwd],
          threadSource: 'appServer',
          excludeTurns: true,
        },
        60_000,
      )
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
      pendingRequests.clear()
      await rpc.stop(async () => {
        if (threadId) await rpc.request('thread/unsubscribe', { threadId }, 1_000)
      })
    },
  }
}
