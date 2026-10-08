import { open, realpath, type FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { TOOL_TIER_DEFAULTS, toolPermissionsSchema } from '@acorn/protocol/toolPermissions.ts'
import { AGENT_TOOLS_PERMS_PREF_KEY } from '@acorn/protocol/api.ts'
import { isToolWithinCeiling, parseToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import type { CoreServices } from '@acorn/plugin-api/node'
import type { StaticDependencyPolicy } from '@acorn/protocol/dependencyPolicy.ts'
import type { AgentSession } from '../contract/wire.ts'
import type { AgentProviderDescriptor } from '../contract/wire.ts'
import type { InstructionAdmissionObservation } from './sessions/instructionAdmission'
import { reportedLoopCoverage } from './sessions/loopHooks'
import type { AgentSessionDefaults } from '../shared/sessionDefaults'
import type { AgentMcpServer } from '../shared/mcpServers'
import type { SecurityDiagnostics, SecurityFinding, SecurityScope, SecurityScopeChoices, SecurityEvidenceState, SecuritySeverity } from '../shared/securityDiagnostics'

const DEADLINE_MS = 4_000
const MAX_FILE_BYTES = 32_768
const MAX_SERVERS = 64
const EXPIRES_MS = 5 * 60_000

export type SecurityDiagnosticPorts = {
  core: Pick<CoreServices, 'projects' | 'tasks' | 'fs' | 'prefs' | 'agentTools' | 'pluginSecurity'>
  defaults(userId: string): Promise<AgentSessionDefaults>
  session(id: string): Promise<AgentSession | null>
  managedMcp(): Promise<AgentMcpServer[]>
  instructionObservation?(projectId: string | null, taskId: string | null): Promise<InstructionAdmissionObservation | null>
  observedProvider?(id: string): AgentProviderDescriptor | null
  staticDependencyPolicy?(root: string): Promise<StaticDependencyPolicy | undefined>
}

export async function securityScopeChoices(
  core: Pick<CoreServices, 'projects' | 'tasks'>,
  listSessions: () => Promise<AgentSession[]>,
): Promise<SecurityScopeChoices> {
  const projects = (await core.projects.checkouts()).slice(0, 100)
  const names = projects.map((project, index) => ({ id: project.id, name: `Project ${index + 1} (${project.id.slice(0, 8)})` }))
  const tasks = await core.tasks.active()
  const projectByTask = new Map(tasks.map((task) => [task.id, task.projectId]))
  const sessions = (await listSessions())
    .filter((session) => !['stopped', 'failed', 'archived'].includes(session.runtimeState))
    .flatMap((session) => {
      const projectId = projectByTask.get(session.taskId)
      return projectId ? [{ id: session.id, projectId, label: `Running session ${session.id.slice(0, 8)}` }] : []
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
    source: string, summary: string, limits: string, repair: string) => {
    findings.push({ id, owner, nodeId, projectId, sessionId, checkedAt, state, severity, source, summary, limits, repair })
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
        'The executable version and harness filesystem or network restrictions are not recorded on this session.', 'Inspect the harness settings and its own configuration.')
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
      'Settings > Security and backup > Agent instruction files.')
    const options = session?.config.configOptions
    const permission = Array.isArray(options) ? options.find((option: unknown) =>
      !!option && typeof option === 'object' && (option as { category?: unknown }).category === 'permission') as { id?: unknown; currentValue?: unknown } | undefined : undefined
    const knownProfiles = new Set(['auto', 'ask', 'read-only', 'workspace-write', 'danger-full-access', 'plan', 'default', 'bypassPermissions', 'acceptEdits', 'dontAsk'])
    const profile = typeof permission?.currentValue === 'string' && knownProfiles.has(permission.currentValue)
      ? permission.currentValue : 'unreported or custom'
    add('harness.permission-profile', 'agents', permission ? 'observed' : 'unknown', 'attention', permission ? 'managed session configuration' : 'session defaults',
      permission ? `Current session permission profile: ${profile}.` : 'No live harness permission profile was reported.',
      'Harness names are descriptive; they do not establish filesystem or network enforcement. Next-session defaults do not override a live session.',
      'Inspect the session settings and harness documentation.')
    const nextValues = session ? (defaults.followLastSession ? defaults.last : defaults.pinned)[session.providerId] : undefined
    const nextProfile = typeof permission?.id === 'string' ? nextValues?.[permission.id] : undefined
    add('harness.next-default', 'agents', nextProfile ? 'configured_only' : 'unknown', 'info', 'agents:session-defaults:v1',
      nextProfile ? `Next-session permission default: ${knownProfiles.has(nextProfile) ? nextProfile : 'custom profile'}.` : 'No next-session permission profile was recorded for this harness.',
      'This default is not the current session profile.', 'Settings > Agents > Harnesses and defaults.')
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
        'Settings > Security and backup > Agent instruction files.')
    } catch {
      add('instructions.latest', 'agents', 'failed', 'attention', 'in-memory pre-turn admission', 'Latest admission outcome could not be read.',
        'No diagnostic scan was run.', 'Retry Check this node.')
    }
  }

  try {
    const snapshot = ports.core.pluginSecurity ? await bounded(() => ports.core.pluginSecurity!.snapshot()) : null
    add('plugins.grants', 'core', snapshot ? 'observed' : 'unknown', snapshot?.executableGrants || snapshot?.developmentEnabled || snapshot?.pendingReview ? 'attention' : 'info',
      'core plugin host state', snapshot
        ? `${snapshot.packages} installed packages; ${snapshot.executableGrants} active executable grants; ${snapshot.developmentEnabled} development modes enabled; ${snapshot.skillsApproved} enabled approved skills, ${snapshot.skillsUnapproved} enabled unapproved skills; ${snapshot.pendingReview} pending changed packages.`
        : 'Passive plugin host facts are unavailable.',
      'Counts omit package names, declarations and grant contents. Host access and plugins outside Acorn remain outside this view.', 'Settings > Plugins.')
  } catch {
    add('plugins.grants', 'core', 'failed', 'attention', 'core plugin host state', 'Plugin host facts could not be read.',
      'A failed read does not mean grants are absent.', 'Settings > Plugins.')
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
      'Only verified catalog names are shown, up to 100. Dynamic availability is evaluated at invocation; the selected session ceiling is applied here.', 'Settings > Tools and permissions.')
    add('agent-tools.ceiling', 'agents', ceiling ? 'observed' : 'unknown', 'attention', 'managed session configuration',
      ceiling ? `Current session ceiling: ${ceiling.maxRisk ?? 'no tier limit'}; ${ceiling.allow?.length ?? 0} explicitly named tools.` : 'No narrower live session ceiling was recorded.',
      'A ceiling further restricts grants; it never grants a denied tool.', 'Inspect the selected session or delegation settings.')
  } catch {
    add('agent-tools.grants', 'core', 'failed', 'attention', 'agent tool preference', 'Tool grants could not be read.',
      'A failed read does not imply a grant.', 'Retry Check this node.')
  }

  try {
    const servers = (await bounded(() => ports.managedMcp())).slice(0, MAX_SERVERS)
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
      add(`mcp.managed.${stableId}`, 'agents', 'configured_only', unpinned || shellDownload ? 'warning' : 'info',
        'Acorn managed MCP store',
        `Managed server ${index + 1}: ${server.enabled ? 'enabled' : 'disabled'} ${server.transport === 'stdio' ? `command ${knownCommand}` : endpoint}${unpinned ? '; package runner has no detected version pin' : ''}${shellDownload ? '; shell or download command requires review' : ''}.`,
        'Arguments, headers, environment entries, credentials, and URL paths are excluded. This does not inspect what a command downloads.',
        'Settings > MCP servers.')
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
      const root = await realpath(project.path)
      const typedPolicy = await ports.staticDependencyPolicy?.(root)
      if (typedPolicy) {
        add('project.package-policy', 'project', typedPolicy.limits.length ? 'unsupported' : 'configured_only', 'attention',
          'Changes static dependency policy capability',
          `Package manager ${typedPolicy.manager}${typedPolicy.managerVersion ? ` ${typedPolicy.managerVersion}` : ''}; policy settings: ${typedPolicy.policyKeys.join(', ') || 'none'}.`,
          `Static configuration only. ${typedPolicy.limits.join(' ').slice(0, 500) || 'Install commands and project code were not run.'}`,
          'Open Changes for revision-specific dependency review.')
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
        'Inspect project package policy and Settings > Project configuration.')
      }
    } catch {
      add('project.package-policy', 'project', 'failed', 'attention', 'selected project files',
        'Static package policy could not be read from the selected project.',
        'No configuration code or package manager was run. A failed read does not imply an unsafe policy.', 'Check the project path and retry.')
    }
  } else add('project.package-policy', 'project', 'unknown', 'info', 'no selected project',
    'Project package policy was not inspected.', 'Select a project for static file evidence.', 'Select a project and check again.')

  add('plugins.grants', 'core', 'unknown', 'attention', 'plugin host',
    'Plugin executable grants, development mode, skill approval, and pending changed packages have no passive diagnostics contract.',
    'No peer plugin database or private host implementation was inspected.', 'Settings > Installed plugins and skills.')
  add('host.limit', 'core', 'observed', 'attention', 'Node security model',
    'The Node owner retains host-level access.', 'These findings are evidence, not an isolation guarantee or security score.', 'Review Node and harness trust before running untrusted work.')
  if (signal.aborted) throw new Error('cancelled')
  return { nodeId, projectId, sessionId, checkedAt, expiresAt: checkedAt + EXPIRES_MS, findings }
}
