import { open, realpath, type FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { TOOL_TIER_DEFAULTS, toolPermissionsSchema } from '@acorn/protocol/toolPermissions.ts'
import { AGENT_TOOLS_PERMS_PREF_KEY } from '@acorn/protocol/api.ts'
import { isToolWithinCeiling, parseToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import type { CompiledCoreServices } from '@acorn/plugin-api/node'
import type { StaticDependencyPolicy } from '@acorn/protocol/dependencyPolicy.ts'
import type { AgentSession } from '../contract/wire.ts'
import type { AgentProviderDescriptor } from '../contract/wire.ts'
import type { InstructionAdmissionObservation } from './sessions/instructionAdmission'
import { reportedLoopCoverage } from './sessions/loopHooks'
import { redactInstructionText } from './sessions/instructionAnalysis'
import type { AgentSessionDefaults } from '../shared/sessionDefaults'
import type { AgentMcpServer } from '../shared/mcpServers'
import type { SecurityDiagnostics, SecurityFinding, SecurityScope, SecurityScopeChoices, SecurityEvidenceState, SecuritySeverity } from '../shared/securityDiagnostics'

const DEADLINE_MS = 4_000
const MAX_FILE_BYTES = 32_768
const MAX_SERVERS = 64
const EXPIRES_MS = 5 * 60_000
const permissionLabels: Record<string, string> = {
  auto: 'Automatic', ask: 'Ask before acting', 'read-only': 'Read only', 'workspace-write': 'Workspace access',
  'danger-full-access': 'Full access', plan: 'Plan only', default: 'Default', bypassPermissions: 'Skip permission prompts',
  acceptEdits: 'Allow edits', dontAsk: 'Do not ask',
}
const riskLabels = { read: 'Read information', write: 'Make changes', execute: 'Run commands' }

function releaseAgeLabel(minutes: number | null): string {
  if (minutes === null) return 'Unknown'
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? 'day' : 'days'}`
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

export type SecurityDiagnosticPorts = {
  core: Pick<CompiledCoreServices, 'projects' | 'tasks' | 'fs' | 'prefs' | 'agentTools' | 'pluginSecurity' | 'nodeKeys'>
  defaults(userId: string): Promise<AgentSessionDefaults>
  session(id: string): Promise<AgentSession | null>
  managedMcp(): Promise<AgentMcpServer[]>
  instructionObservation?(projectId: string | null, taskId: string | null): Promise<InstructionAdmissionObservation | null>
  observedProvider?(id: string): AgentProviderDescriptor | null
  /** Harness ids that can keep their agent out of the data root (docs/managed-agents/read-block.md). */
  readBlockProviders?(): string[]
  staticDependencyPolicy?(root: string, signal?: AbortSignal): Promise<StaticDependencyPolicy | undefined>
}

export async function securityScopeChoices(
  core: Pick<CompiledCoreServices, 'projects' | 'tasks'>,
  listSessions: () => Promise<AgentSession[]>,
): Promise<SecurityScopeChoices> {
  const projects = (await core.projects.checkouts()).slice(0, 100)
  const names = (await Promise.all(projects.map((project) => core.projects.byId(project.id))))
    .flatMap((project) => project ? [{ id: project.id, name: project.name }] : [])
  const tasks = await core.tasks.active()
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const sessions = (await listSessions())
    .filter((session) => !['stopped', 'failed', 'archived'].includes(session.runtimeState))
    .flatMap((session) => {
      const task = taskById.get(session.taskId)
      return task ? [{ id: session.id, projectId: task.projectId, label: session.title || task.title }] : []
    })
  return { projects: names, sessions }
}

/** Read a fixed filename only. The core confinement seam rejects symlink escape; an already-opened
 * descriptor avoids a later pathname swap, and the length limit bounds all parsing work. */
async function fixedFile(ports: SecurityDiagnosticPorts, root: string, name: string, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) throw new Error('cancelled')
  const path = ports.core.fs.resolveInRoot(root, name)
  if (!path) throw new Error('outside project root')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!file) return null
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('unsupported file size or type')
    const resolved = await realpath(path)
    const canonical = await realpath(root)
    if (resolved !== canonical && !resolved.startsWith(canonical + '/')) throw new Error('outside project root')
    return await readBoundedFile(file, signal)
  } finally { await file.close() }
}

/** Handles short reads and growth after fstat without ever buffering more than the cap. */
export async function readBoundedFile(file: Pick<FileHandle, 'read'>, signal: AbortSignal): Promise<string> {
  const chunks: Buffer[] = []
  let offset = 0
  while (true) {
    if (signal.aborted) throw new Error('cancelled')
    const chunk = Buffer.alloc(Math.min(4096, MAX_FILE_BYTES + 1 - offset))
    const { bytesRead } = await file.read(chunk, 0, chunk.length, offset)
    if (bytesRead === 0) break
    offset += bytesRead
    if (offset > MAX_FILE_BYTES) throw new Error('file grew beyond limit')
    chunks.push(chunk.subarray(0, bytesRead))
  }
  if (signal.aborted) throw new Error('cancelled')
  return Buffer.concat(chunks).toString('utf8')
}

export async function collectSecurityDiagnostics(
  ports: SecurityDiagnosticPorts,
  nodeId: string,
  userId: string,
  scope: SecurityScope,
  signal: AbortSignal,
): Promise<SecurityDiagnostics> {
  const checkedAt = Date.now()
  const findings: SecurityFinding[] = []
  const projectId = scope.projectId ?? null
  const sessionId = scope.sessionId ?? null
  const add = (id: string, owner: SecurityFinding['owner'], state: SecurityEvidenceState, severity: SecuritySeverity,
    source: string, summary: string, limits: string, repair: string,
    display: Pick<SecurityFinding, 'title' | 'description' | 'facts'> = {}) => {
    findings.push({ id, owner, nodeId, projectId, sessionId, checkedAt, state, severity, source, summary, limits, repair, ...display })
  }
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
    if (signal.aborted) throw new Error('cancelled')
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const cutoff = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('collector timed out')), DEADLINE_MS)
      timer.unref?.()
      onAbort = () => reject(new Error('collector cancelled'))
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try { return await Promise.race([work(), cutoff]) }
    finally {
      if (timer) clearTimeout(timer)
      if (onAbort) signal.removeEventListener('abort', onAbort)
    }
  }

  let session: AgentSession | null = null
  if (sessionId) {
    try {
      session = await bounded(() => ports.session(sessionId))
      if (!session || session.archivedAt != null || ['stopped', 'failed', 'archived'].includes(session.runtimeState)) throw new Error('not running')
      if (projectId) {
        const task = await bounded(() => ports.core.tasks.load(session!.taskId))
        if (!task || task.projectId !== projectId) throw new Error('different project')
      }
      const harness = session.providerId === 'codex' ? 'Codex'
        : session.providerId === 'claude' || session.providerId === 'claude-code' ? 'Claude Code' : 'Contributed harness'
      const driver = ['acp', 'codex-app-server', 'terminal'].includes(session.driverKind) ? session.driverKind : 'custom driver'
      const version = /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(session.driverVersion) ? session.driverVersion : 'unreported version'
      add('harness.identity', 'agents', 'observed', 'info', 'managed session',
        `${harness} session; driver ${driver} ${version}.`,
        'The executable version and harness filesystem or network restrictions are not recorded on this session.', 'Inspect the harness settings and its own configuration.',
        { description: `You selected a running ${harness} agent. Its recorded settings are included below.` })
      const descriptor = ports.observedProvider?.(session.providerId)
      const coverage = descriptor?.installed ? reportedLoopCoverage(descriptor) : null
      add('harness.loop', 'agents', coverage ? coverage.beforeTool === 'none' && !coverage.afterTool ? 'unsupported' : 'observed' : 'unknown',
        'attention', 'last observed harness capabilities', coverage
          ? `${coverage.beforeTool === 'every' ? 'Before-tool capability covers every call' : coverage.beforeTool === 'asked' ? 'Permission capability covers requests only' : 'No before-tool capability reported'}; ${coverage.afterTool ? 'after-tool capability reported' : 'no after-tool capability reported'}.`
          : 'No passive harness capability descriptor is available.',
        'Reported capabilities describe bridge reach, not registered hooks, host policy, or filesystem and network confinement.', 'See Managed agents > Loop hooks.')
      add('harness.restrictions', 'agents', 'unknown', 'attention', 'managed session metadata',
        'Executable version, filesystem restrictions, and network restrictions were not recorded as passive session evidence.',
        'A driver profile or mode name does not prove operating-system confinement.', 'Inspect the harness configuration and verify restrictions manually.')
    } catch {
      add('session.selection', 'agents', 'failed', 'attention', 'session lookup', 'The selected running session could not be verified.',
        'No session settings were used.', 'Select a running session and check again.')
      session = null
    }
  } else add('harness.identity', 'agents', 'unknown', 'attention', 'no running session',
    'Harness identity, version, restrictions, and loop coverage are unknown without a running session.',
    'Checking installed harnesses could start configured executables.', 'Select a running session or inspect the harness manually.')

  try {
    const defaults = await bounded(() => ports.defaults(userId))
    add('instructions.checks', 'agents', 'configured_only', defaults.checkInstructionFiles || defaults.reviewChangedInstructions ? 'info' : 'attention',
      'agents:session-defaults:v1',
      `Hidden-character check ${defaults.checkInstructionFiles ? 'enabled' : 'disabled'}; changed-instruction approval ${defaults.reviewChangedInstructions ? 'enabled' : 'disabled'}.`,
      'Scope: discovered repository AGENTS.md, CLAUDE.md, supported imports and skills, plus delivered plugin skills. Global harness files may be outside it. Only the latest observed admission per task is kept in memory.',
      'Settings > Security and backup > Agent instruction files.', {
        description: 'These optional checks help you review the instructions agents read before they act.',
        facts: [
          { label: 'Hidden characters', value: defaults.checkInstructionFiles ? 'Checked before each turn' : 'Not checked' },
          { label: 'Instruction changes', value: defaults.reviewChangedInstructions ? 'Your approval required' : 'No approval required' },
        ],
      })
    const blockers = ports.readBlockProviders?.() ?? []
    const blocked = session ? defaults.blockDataRootReads && blockers.includes(session.providerId) : null
    add('agents.read-block', 'agents', 'configured_only', blocked === false ? 'warning' : defaults.blockDataRootReads ? 'info' : 'attention',
      'agents:session-defaults:v1',
      `Data root read block ${defaults.blockDataRootReads ? 'enabled' : 'disabled'}; harnesses that support it: ${blockers.join(', ') || 'none'}.${blocked === null ? '' : ` Selected session ${blocked ? 'starts blocked' : 'is not blocked'}.`}`,
      "Applies from each session's next start, so a session already running keeps how it started. Other harnesses can read the whole data root.",
      'Settings > Security and backup > Agent access to Acorn data.', {
        title: 'Agent access to Acorn data',
        description: blocked === false
          ? "This agent can read Acorn's data folder, including other sessions' tokens and the task database."
          : defaults.blockDataRootReads
            ? "Agents on harnesses that support it are kept out of Acorn's data folder from their next start."
            : "Agents can read Acorn's data folder, including other sessions' tokens and the task database.",
        facts: [
          { label: 'Block', value: defaults.blockDataRootReads ? 'On' : 'Off' },
          ...(blocked === null ? [] : [{ label: 'Selected agent', value: blocked ? 'Blocked from its next start' : 'Not blocked' }]),
        ],
      })
    const options = session?.config.configOptions
    const permission = Array.isArray(options) ? options.find((option: unknown) =>
      !!option && typeof option === 'object' && (option as { category?: unknown }).category === 'permission') as { id?: unknown; currentValue?: unknown } | undefined : undefined
    const knownProfiles = new Set(['auto', 'ask', 'read-only', 'workspace-write', 'danger-full-access', 'plan', 'default', 'bypassPermissions', 'acceptEdits', 'dontAsk'])
    const profile = typeof permission?.currentValue === 'string' && knownProfiles.has(permission.currentValue)
      ? permission.currentValue : 'unreported or custom'
    add('harness.permission-profile', 'agents', permission ? 'observed' : 'unknown',
      permission && ['danger-full-access', 'bypassPermissions'].includes(profile) ? 'warning' : 'attention', permission ? 'managed session configuration' : 'session defaults',
      permission ? `Current session permission profile: ${profile}.` : 'No live harness permission profile was reported.',
      'Harness names are descriptive; they do not establish filesystem or network enforcement. Next-session defaults do not override a live session.',
      'Inspect the session settings and harness documentation.', permission ? {
        description: ['danger-full-access', 'bypassPermissions'].includes(profile)
          ? 'This agent reports broad permissions. Review its settings before asking it to work with unfamiliar code.'
          : 'This is the permission mode reported by the selected agent. Its own settings determine what it can do.',
        facts: [{ label: 'Reported permission mode', value: permissionLabels[profile] ?? 'Custom or unknown' }],
      } : {})
    const nextValues = session ? (defaults.followLastSession ? defaults.last : defaults.pinned)[session.providerId] : undefined
    const nextProfile = typeof permission?.id === 'string' ? nextValues?.[permission.id] : undefined
    add('harness.next-default', 'agents', nextProfile ? 'configured_only' : 'unknown', 'info', 'agents:session-defaults:v1',
      nextProfile ? `Next-session permission default: ${knownProfiles.has(nextProfile) ? nextProfile : 'custom profile'}.` : 'No next-session permission profile was recorded for this harness.',
      'This default is not the current session profile.', 'Settings > Agents > Harnesses and defaults.', nextProfile ? {
        description: 'This permission mode applies to agents you start later. It does not change the running agent.',
        facts: [{ label: 'Default permission mode', value: permissionLabels[nextProfile] ?? 'Custom' }],
      } : {})
  } catch {
    add('instructions.checks', 'agents', 'failed', 'attention', 'session defaults', 'Instruction settings could not be read.',
      'A failed read does not mean checks are disabled.', 'Retry Check this node.')
  }

  if (projectId) add('instructions.approval', 'agents', 'unknown', 'attention', 'encrypted instruction review store',
    'Current approval status is not available to this passive check.',
    'Validating a stored approval decrypts instruction bodies. This diagnostic does not read them or start a scan.',
    'Settings > Security and backup > Review instruction files.')

  if (ports.instructionObservation && (projectId || session?.taskId)) {
    try {
      const observation = await bounded(() => ports.instructionObservation!(projectId, session?.taskId ?? null))
      add('instructions.latest', 'agents', observation ? 'observed' : 'unknown', observation?.outcome === 'blocked' || observation?.outcome === 'incomplete' ? 'warning' : 'info',
        'in-memory pre-turn admission', observation
          ? `Last check ${new Date(observation.checkedAt).toISOString()}: ${observation.outcome}.`
          : 'No pre-turn instruction check has been observed for this scope in this Node process.',
        'One latest outcome per task is retained in memory, with no report history. This diagnostic does not run a scan.',
        'Settings > Security and backup > Agent instruction files.', observation ? {
          description: observation.outcome === 'passed' ? 'The last instruction check allowed the agent to continue.'
            : observation.outcome === 'blocked' ? 'The last instruction check stopped the agent. Review its instruction files before continuing.'
            : 'The last instruction check could not finish, so the agent was stopped. Review the files or retry the turn.',
          facts: [{ label: 'Last checked', value: new Date(observation.checkedAt).toLocaleString() }],
        } : {})
    } catch {
      add('instructions.latest', 'agents', 'failed', 'attention', 'in-memory pre-turn admission', 'Latest admission outcome could not be read.',
        'No diagnostic scan was run.', 'Retry Check this node.')
    }
  }

  try {
    const snapshot = ports.core.pluginSecurity ? await bounded(() => ports.core.pluginSecurity!.snapshot()) : null
    add('plugins.grants', 'core', snapshot ? 'observed' : 'unknown', snapshot?.pendingReview || snapshot?.skillsUnapproved ? 'warning' : 'info',
      'core plugin host state', snapshot
        ? `${snapshot.packages} installed packages; ${snapshot.executableGrants} active executable grants; ${snapshot.developmentEnabled} development modes enabled; ${snapshot.skillsApproved} enabled approved skills, ${snapshot.skillsUnapproved} enabled unapproved skills; ${snapshot.pendingReview} pending changed packages.`
        : 'Passive plugin host facts are unavailable.',
      'Counts omit package names, declarations and grant contents. Host access and plugins outside Acorn remain outside this view.', 'Settings > Plugins.', snapshot ? {
        description: snapshot.pendingReview || snapshot.skillsUnapproved
          ? 'Some plugin changes or skills are waiting for your review.'
          : 'These are the plugins and permissions recorded by Acorn. Review individual plugins before trusting their code.',
        facts: [
          { label: 'Installed plugins', value: String(snapshot.packages) },
          { label: 'Allowed to run code', value: String(snapshot.executableGrants) },
          { label: 'Development mode', value: String(snapshot.developmentEnabled) },
          { label: 'Skills awaiting approval', value: String(snapshot.skillsUnapproved) },
          { label: 'Changed plugins awaiting review', value: String(snapshot.pendingReview) },
        ],
      } : {})
  } catch {
    add('plugins.grants', 'core', 'failed', 'attention', 'core plugin host state', 'Plugin host facts could not be read.',
      'A failed read does not mean grants are absent.', 'Settings > Plugins.')
  }

  const keys = ports.core.nodeKeys?.snapshot()
  if (keys) {
    const sealed = keys.delivery === 'desktop'
    const exposed = !sealed || keys.plainFiles.length > 0
    add('host.keys', 'core', 'observed', exposed ? 'warning' : 'info', 'core key custody',
      sealed
        ? `The desktop app delivered this Node's keys in its start message. Plain key files in the data root: ${keys.plainFiles.join(', ') || 'none'}. Session key check: ${keys.keyCheck ?? 'not run'}.`
        : `This Node reads its signing and encryption keys from files in its data root (${keys.plainFiles.join(', ') || 'not yet written'}) or from SESSION_ENC_KEY in its environment.`,
      "Agents run as the same OS user as the Node and can read the rest of the data root, including other sessions' token files and the task database. Sealed keys are only as safe as the desktop's data key, which a dev build keeps in a plain data.key file.",
      !sealed ? 'Run untrusted work on a Node the desktop app starts.'
        : keys.plainFiles.length ? 'Restart Acorn. If a file stays, Settings > Audit log says why.' : 'No action needed.', {
        title: "This Node's keys",
        description: !sealed
          ? 'Agents on this Node can read the keys that sign its internal tokens and decrypt its stored credentials.'
          : keys.plainFiles.length
            ? 'The keys are sealed, but a plain copy is still in the data root, where agents can read it.'
            : 'The keys are sealed under the desktop app\'s keychain key. No plain copy is in the data root.',
        facts: [
          { label: 'Keys from', value: sealed ? 'Desktop app, sealed' : 'Files or environment' },
          { label: 'Plain key files', value: keys.plainFiles.join(', ') || 'None' },
        ],
      })
  }

  try {
    const raw = await bounded(() => ports.core.prefs.read(userId, AGENT_TOOLS_PERMS_PREF_KEY))
    const parsed = toolPermissionsSchema.safeParse(raw ? JSON.parse(raw) : {})
    const perms = parsed.success ? parsed.data : {}
    const tiers = Object.entries(TOOL_TIER_DEFAULTS).map(([tier, defaultValue]) => `${tier}: ${perms.tiers?.[tier as keyof typeof TOOL_TIER_DEFAULTS] ?? defaultValue ? 'allowed' : 'denied'}`)
    const catalog = ports.core.agentTools ? (await bounded(() => ports.core.agentTools!.catalog())).slice(0, 100) : []
    const ceiling = session ? parseToolCeiling(session.config.toolCeiling) : null
    const grants = catalog.map((tool) => {
      const allowed = perms.tools?.[tool.name]
        ?? (tool.risk === 'read' ? true : perms.tiers?.[tool.risk] ?? TOOL_TIER_DEFAULTS[tool.risk])
      return { name: tool.name, allowed: allowed && isToolWithinCeiling(tool, ceiling ?? undefined) }
    })
    const shown = grants.filter((grant) => /^[a-z][a-z0-9_]{0,63}$/.test(grant.name))
    add('agent-tools.grants', 'core', !ports.core.agentTools ? 'unknown' : parsed.success ? 'configured_only' : 'failed', 'attention', 'agent tool preference',
      `Tiers ${tiers.join(', ')}. Effective registered tools: ${shown.map((grant) => `${grant.name} ${grant.allowed ? 'allowed' : 'denied'}`).join(', ') || 'none'}.`,
      'Only verified catalog names are shown, up to 100. Dynamic availability is evaluated at invocation; the selected session ceiling is applied here.', 'Settings > Tools and permissions.', parsed.success && ports.core.agentTools ? {
        description: `Of the ${shown.length} Acorn tools checked, ${shown.filter((grant) => grant.allowed).length} are allowed and ${shown.filter((grant) => !grant.allowed).length} are blocked. This does not cover tools provided by the agent itself.`,
        facts: Object.entries(TOOL_TIER_DEFAULTS).map(([tier, defaultValue]) => ({
          label: `Default: ${riskLabels[tier as keyof typeof riskLabels].toLowerCase()}`,
          value: (perms.tiers?.[tier as keyof typeof TOOL_TIER_DEFAULTS] ?? defaultValue) ? 'Allowed' : 'Blocked',
        })),
      } : {})
    add('agent-tools.ceiling', 'agents', ceiling ? 'observed' : 'unknown', 'attention', 'managed session configuration',
      ceiling ? `Current session ceiling: ${ceiling.maxRisk ?? 'no tier limit'}; ${ceiling.allow?.length ?? 0} explicitly named tools.` : 'No narrower live session ceiling was recorded.',
      'A ceiling further restricts grants; it never grants a denied tool.', 'Inspect the selected session or delegation settings.', ceiling ? {
        description: 'The selected agent has additional limits on its Acorn tools. These limits can only reduce its access.',
        facts: [
          { label: 'Highest permitted action', value: ceiling.maxRisk ? riskLabels[ceiling.maxRisk] : 'No action limit recorded' },
          { label: 'Named tools in its limit', value: String(ceiling.allow?.length ?? 0) },
        ],
      } : {})
  } catch {
    add('agent-tools.grants', 'core', 'failed', 'attention', 'agent tool preference', 'Tool grants could not be read.',
      'A failed read does not imply a grant.', 'Retry Check this node.')
  }

  try {
    const servers = (await bounded(() => ports.managedMcp())).slice(0, MAX_SERVERS)
    if (!servers.length) add('mcp.managed', 'agents', 'configured_only', 'info', 'Acorn managed MCP store',
      'No owner-managed MCP servers are configured.', 'Personal agent configuration is outside this list.', 'Settings > MCP servers.',
      { description: 'You have not added any extra MCP servers in Acorn.' })
    for (const [index, server] of servers.entries()) {
      const command = server.command?.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
      const unpinned = ['npx', 'pnpx', 'yarn', 'bunx', 'uvx'].includes(command)
        && !server.args.some((arg) => /@\d/.test(arg))
      const shellDownload = /^(sh|bash|zsh|curl|wget)$/i.test(command)
      let endpoint = 'configured endpoint'
      if (server.url) {
        try { const url = new URL(server.url); endpoint = `${url.protocol} endpoint` } catch { endpoint = 'invalid endpoint' }
      }
      const knownCommand = ['npx', 'pnpx', 'yarn', 'bunx', 'uvx', 'node', 'python', 'python3', 'sh', 'bash', 'zsh', 'curl', 'wget'].includes(command)
        ? command : 'custom executable'
      const stableId = createHash('sha256').update(server.name).digest('hex').slice(0, 12)
      let displayName = redactInstructionText(server.name)
      for (const value of server.values) if (value.value) displayName = displayName.replaceAll(value.value, '[redacted]')
      displayName = displayName.slice(0, 160)
      const management = server.managed
        ? `exact npm ${server.managed.package}@${server.managed.version}; ${server.managed.graph.length} locked packages; scripts disabled by installer`
        : server.transport === 'stdio' ? 'owner command' : 'owner HTTP endpoint'
      const review = server.reviewTools
        ? server.approvedCatalogueDigest ? 'catalogue approved for saved revision; live connection rechecks remain unknown here' : 'catalogue review enabled; no approval for saved revision'
        : 'catalogue review off'
      add(`mcp.managed.${stableId}`, 'agents', 'configured_only', server.enabled && (unpinned || shellDownload || !server.consented || (server.reviewTools && !server.approvedCatalogueDigest)) ? 'warning' : 'info',
        'Acorn managed MCP store',
        `Server ${index + 1}: ${server.enabled ? 'enabled' : 'disabled'}; ${management}; ${server.consented ? 'device consent recorded' : 'consent pending'}; ${review}; ${server.transport === 'stdio' ? `command ${knownCommand}` : endpoint}${unpinned ? '; package runner has no detected version pin' : ''}${shellDownload ? '; shell or download command requires review' : ''}.`,
        'Passive saved-state check. No installation, secret reveal, server start, or catalogue probe ran. Arguments, headers, credentials, and URL paths are excluded.',
        'Settings > MCP servers.', {
          title: `${displayName || `Server ${index + 1}`} (MCP)`,
          description: !server.enabled ? 'This server is turned off for new agents.'
            : !server.consented ? 'This server needs your consent before Acorn can start it.'
            : unpinned ? 'This server uses a package runner without a detected fixed version. Its code could change between starts.'
            : shellDownload ? 'This server runs a shell or download command. Review what it runs before using it.'
            : server.reviewTools && !server.approvedCatalogueDigest ? 'This server is waiting for you to approve its tool definitions.'
            : 'These are the saved settings for this server. This check did not connect to it.',
          facts: [
            { label: 'For new agents', value: server.enabled ? 'On' : 'Off' },
            { label: 'Installation', value: server.managed ? `Fixed version: ${server.managed.package}@${server.managed.version}` : server.transport === 'stdio' ? 'Your command' : 'Remote server' },
            { label: 'Your consent', value: server.consented ? 'Recorded' : 'Required' },
            { label: 'Tool changes', value: !server.reviewTools ? 'Review is off' : server.approvedCatalogueDigest ? 'Saved approval; live tools not checked here' : 'Awaiting approval' },
          ],
        })
    }
    add('mcp.unmanaged', 'agents', 'unknown', 'attention', 'harness configuration',
      'Harness-reported or global MCP servers are not available from a passive cached snapshot.',
      'Acorn cannot see all global harness configuration or hooks.', 'Inspect the harness configuration and a running session MCP panel.')
  } catch {
    add('mcp.managed', 'agents', 'failed', 'attention', 'Acorn managed MCP store', 'Managed MCP settings could not be read.',
      'No MCP command was started.', 'Retry Check this node.')
  }

  if (projectId) {
    try {
      const project = await bounded(() => ports.core.projects.byId(projectId))
      if (!project?.path) throw new Error('no project checkout')
      const projectPath = project.path
      const root = await bounded(() => realpath(projectPath))
      const typedPolicy = ports.staticDependencyPolicy ? await bounded(() => ports.staticDependencyPolicy!(root, signal)) : undefined
      if (typedPolicy) {
        add('project.package-policy', 'project', typedPolicy.limits.length ? 'unsupported' : 'configured_only', 'attention',
          'Changes static dependency policy capability',
          `Package manager ${typedPolicy.manager}${typedPolicy.managerVersion ? ` ${typedPolicy.managerVersion}` : ''}; policy settings: ${typedPolicy.policyKeys.join(', ') || 'none'}; release age ${typedPolicy.releaseAgeMinutes === null ? 'unknown' : `${typedPolicy.releaseAgeMinutes} minutes`}; ignore scripts ${typedPolicy.ignoreScripts === null ? 'unknown' : typedPolicy.ignoreScripts ? 'enabled' : 'disabled'}; build approvals ${typedPolicy.buildApprovalCount ?? 'unknown'}; ignored builds ${typedPolicy.buildIgnoreCount ?? 'unknown'}; allow all builds ${typedPolicy.allowAllBuilds === null ? 'unknown' : typedPolicy.allowAllBuilds ? 'enabled' : 'disabled'}; release-age exceptions ${typedPolicy.releaseAgeExceptionCount ?? 'unknown'}; registry origins ${typedPolicy.registryOrigins.join(', ') || 'unknown'}; source policy ${typedPolicy.sourcePolicyKeys.join(', ') || 'none'}.`,
          `Static configuration only. ${typedPolicy.limits.join(' ').slice(0, 500) || 'Install commands and project code were not run.'}`,
          'Open Changes for revision-specific dependency review.', {
            description: 'These are the install rules saved in the project. Acorn did not install or inspect the packages themselves.',
            facts: [
              { label: 'Package manager', value: `${typedPolicy.manager}${typedPolicy.managerVersion ? ` ${typedPolicy.managerVersion}` : ''}` },
              { label: 'Wait before accepting a release', value: releaseAgeLabel(typedPolicy.releaseAgeMinutes) },
              { label: 'Install scripts', value: typedPolicy.ignoreScripts === null ? 'Unknown' : typedPolicy.ignoreScripts ? 'Blocked' : 'Allowed' },
              { label: 'Packages allowed to build', value: typedPolicy.buildApprovalCount === null ? 'Unknown' : String(typedPolicy.buildApprovalCount) },
              { label: 'Packages blocked from building', value: typedPolicy.buildIgnoreCount === null ? 'Unknown' : String(typedPolicy.buildIgnoreCount) },
              { label: 'Allow every package to build', value: typedPolicy.allowAllBuilds === null ? 'Unknown' : typedPolicy.allowAllBuilds ? 'Yes' : 'No' },
            ],
          })
      } else {
      const [packageJson, npmrc, workspace] = await bounded(() => Promise.all([
        fixedFile(ports, root, 'package.json', signal), fixedFile(ports, root, '.npmrc', signal), fixedFile(ports, root, 'pnpm-workspace.yaml', signal),
      ]))
      let manager = 'unknown'
      let scripts = 'unknown'
      let manifestPolicy = 'no recognized manifest policy'
      if (packageJson) {
        const data = JSON.parse(packageJson) as Record<string, unknown>
        manager = typeof data.packageManager === 'string' && /^(pnpm|npm|yarn|bun)@\d+(?:\.\d+){0,2}$/.test(data.packageManager)
          ? data.packageManager : 'unreported or unsupported'
        scripts = data.scripts && typeof data.scripts === 'object' ? 'package scripts declared' : 'no package scripts declared'
        const dependencies = [data.dependencies, data.devDependencies, data.optionalDependencies].flatMap((value) =>
          value && typeof value === 'object' && !Array.isArray(value) ? Object.values(value) : [])
        if (dependencies.some((value) => typeof value === 'string' && /^(git\+|git:|github:|https?:)/.test(value))) scripts += '; Git or URL dependency source declared'
        const pnpm = data.pnpm && typeof data.pnpm === 'object' ? data.pnpm as Record<string, unknown> : {}
        const present = ['onlyBuiltDependencies', 'ignoredBuiltDependencies', 'overrides'].filter((key) => key in pnpm)
        if (present.length) manifestPolicy = `pnpm manifest keys: ${present.join(', ')}`
      }
      const npmLines = (npmrc ?? '').split(/\r?\n/).filter((line) => !line.trim().startsWith('#'))
      const npmKeys = npmLines.map((line) => line.split('=')[0]?.trim()).filter(Boolean)
      const known = npmKeys.filter((key) => ['ignore-scripts', 'minimum-release-age', 'minimumReleaseAge', 'registry', 'strict-ssl'].includes(key))
      const scriptPolicy = npmLines.some((line) => /^\s*ignore-scripts\s*=\s*true\s*$/i.test(line)) ? 'ignore-scripts enabled'
        : npmLines.some((line) => /^\s*ignore-scripts\s*=\s*false\s*$/i.test(line)) ? 'ignore-scripts disabled' : 'ignore-scripts unreported'
      const age = workspace?.match(/^\s*minimumReleaseAge:\s*(\d{1,6})\s*$/m)?.[1]
      const workspaceKeys = ['minimumReleaseAgeExclude', 'allowBuilds', 'overrides', 'catalog'].filter((key) =>
        workspace && new RegExp(`^\\s*${key}:`, 'm').test(workspace))
      add('project.package-policy', 'project', 'configured_only', 'attention', 'package.json, .npmrc, pnpm-workspace.yaml',
        `Package manager ${manager}; ${scripts}; ${manifestPolicy}; ${scriptPolicy}; .npmrc setting names: ${known.join(', ') || 'none'}; pnpm release-age ${age ? `${age} minutes` : 'unreported'}; workspace policy keys: ${workspaceKeys.join(', ') || 'none'}.`,
        'Presence of a policy is configured intent only. This pass does not interpret YAML collections, exceptions, registry values, JS configuration, or other package runners. Phase 08 owns detailed dependency parsing.',
        'Inspect project package policy and Settings > Project configuration.', {
          description: 'Some package settings were read, but a full dependency policy review is unavailable. Open Changes to review package changes.',
          facts: [{ label: 'Package manager', value: manager }],
        })
      }
    } catch {
      add('project.package-policy', 'project', 'failed', 'attention', 'selected project files',
        'Static package policy could not be read from the selected project.',
        'No configuration code or package manager was run. A failed read does not imply an unsafe policy.', 'Check the project path and retry.')
    }
  } else add('project.package-policy', 'project', 'unknown', 'info', 'no selected project',
    'Project package policy was not inspected.', 'Select a project for static file evidence.', 'Select a project and check again.')

  add('host.limit', 'core', 'observed', 'attention', 'Node security model',
    'The Node owner retains host-level access.', 'These findings are evidence, not an isolation guarantee or security score.', 'Review Node and harness trust before running untrusted work.')
  if (signal.aborted) throw new Error('cancelled')
  return { nodeId, projectId, sessionId, checkedAt, expiresAt: checkedAt + EXPIRES_MS, findings }
}
