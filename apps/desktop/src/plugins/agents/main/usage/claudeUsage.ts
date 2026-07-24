import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AgentProviderUsage,
  AgentUsageCost,
  AgentUsageQuota,
} from '../../shared/usage'
import { clampRemaining, usageHealth, worstUsageHealth } from '../../shared/usage'
import { analyzeClaudeDailyUsage } from './claudeDailyUsage'
import {
  capturePty,
  UsageProcessError,
  usageProcessEnv,
  type PtyCaptureOptions,
  type PtyCaptureResult,
} from './processRunner'

type ClaudeAccount = { email: string | null; organization: string | null } | null
type RunPty = (options: PtyCaptureOptions) => Promise<PtyCaptureResult>

export type ClaudeUsageOptions = {
  probeDir: string
  configFile?: string
  claudeDir?: string
  now?: () => number
  runPty?: RunPty
}

const PROMPT_RESPONSES = [
  { pattern: /Esc to cancel/i, response: '\r' },
  { pattern: /Ready to code here\?/i, response: '\r' },
  { pattern: /Press Enter to continue/i, response: '\r' },
  { pattern: /ctrl\+t to disable/i, response: '\r' },
  { pattern: /Yes, I trust this folder/i, response: '\r' },
]

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function claudePaths(): { configFile: string; claudeDir: string } {
  const configured = process.env.CLAUDE_CONFIG_DIR
  return configured
    ? { configFile: join(configured, '.claude.json'), claudeDir: configured }
    : { configFile: join(homedir(), '.claude.json'), claudeDir: join(homedir(), '.claude') }
}

async function readAccount(configFile: string): Promise<ClaudeAccount> {
  try {
    const root = asObject(JSON.parse(await readFile(configFile, 'utf8')))
    const account = asObject(root?.oauthAccount)
    if (!account) return null
    const email = typeof account.emailAddress === 'string' ? account.emailAddress : null
    const organization = typeof account.displayName === 'string' ? account.displayName : null
    return email || organization ? { email, organization } : null
  } catch {
    return null
  }
}

export async function trustClaudeProbeDirectory(configFile: string, probeDir: string): Promise<boolean> {
  let metadata
  let root: Record<string, unknown>
  try {
    metadata = await stat(configFile)
    root = asObject(JSON.parse(await readFile(configFile, 'utf8'))) ?? (() => {
      throw new Error('Claude config must be a JSON object.')
    })()
  } catch {
    return false
  }
  const currentProjects = root.projects
  if (currentProjects != null && !asObject(currentProjects)) return false
  const projects = { ...(asObject(currentProjects) ?? {}) }
  const currentEntry = projects[probeDir]
  if (currentEntry != null && !asObject(currentEntry)) return false
  const entry = { ...(asObject(currentEntry) ?? {}) }
  if (entry.hasTrustDialogAccepted === true) return true
  entry.hasTrustDialogAccepted = true
  projects[probeDir] = entry
  root.projects = projects

  const temporary = join(dirname(configFile), `.${basename(configFile)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(root, null, 2)}\n`, { mode: metadata.mode & 0o777 })
    await chmod(temporary, metadata.mode & 0o777)
    await rename(temporary, configFile)
    return true
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined)
    return false
  }
}

function classifyClaudeOutput(text: string): 'trust' | 'cost' | UsageProcessError | null {
  const lower = text.toLowerCase()
  if (
    (lower.includes('do you trust the files in this folder?') ||
      lower.includes('is this a project you created or one you trust')) &&
    !lower.includes('current session')
  ) {
    return 'trust'
  }
  if (lower.includes('/usage is only available for subscription plans')) return 'cost'
  if (lower.includes('token_expired') || lower.includes('token has expired') || lower.includes('authentication_error')) {
    return new UsageProcessError('authentication_required', 'Claude authentication has expired. Run `claude` and sign in again.')
  }
  if (lower.includes('not logged in') || lower.includes('please log in')) {
    return new UsageProcessError('authentication_required', 'Claude is not logged in. Run `claude` and sign in.')
  }
  if (lower.includes('update required') || lower.includes('please update')) {
    return new UsageProcessError('update_required', 'Claude CLI must be updated before usage can be read.')
  }
  return null
}

function percentFrom(text: string): number | null {
  const match = text.match(/([0-9]{1,3}(?:\.[0-9]+)?)\s*%\s*(used|left)/i)
  if (!match) return null
  const raw = Number(match[1])
  return clampRemaining(match[2].toLowerCase() === 'used' ? 100 - raw : raw)
}

function resetTextFrom(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (!/\breset/i.test(line)) continue
    const resets = [...line.matchAll(/resets/gi)]
    const start = resets.at(-1)?.index ?? 0
    const text = line.slice(start).replace(/\s+\d{1,3}(?:\.\d+)?%\s*(?:used|left)\s*$/i, '').trim()
    if (text) return /^resets?/i.test(text) ? text : `Resets ${text}`
  }
  return null
}

export function parseClaudeReset(resetText: string | null, now = Date.now()): number | null {
  if (!resetText) return null
  const days = Number(resetText.match(/(\d+)\s*d(?:ays?)?/i)?.[1] ?? 0)
  const hours = Number(resetText.match(/(\d+)\s*h(?:ours?|r)?/i)?.[1] ?? 0)
  const minutes = Number(resetText.match(/(\d+)\s*m(?:in(?:utes?)?)?/i)?.[1] ?? 0)
  const relativeMs = ((days * 24 + hours) * 60 + minutes) * 60_000
  if (relativeMs > 0) return now + relativeMs
  const cleaned = resetText
    .replace(/^resets?\s*/i, '')
    .replace(/\s*\([^)]+\)\s*$/, '')
    .replace(/\s+at\s+/i, ' ')
    .trim()
  const parsed = Date.parse(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function section(lines: readonly string[], index: number): string[] {
  return lines.slice(index, index + 14)
}

function quotaFromSection(
  id: string,
  label: string,
  lines: readonly string[],
  now: number,
  fallbackReset: { text: string | null; at: number | null } | null = null,
): AgentUsageQuota | null {
  const percent = lines.map(percentFrom).find((value): value is number => value !== null)
  if (percent == null) return null
  const ownResetText = resetTextFrom(lines)
  const resetText = ownResetText ?? fallbackReset?.text ?? null
  const resetsAt = ownResetText ? parseClaudeReset(ownResetText, now) : fallbackReset?.at ?? null
  return { id, label, percentRemaining: percent, resetsAt, resetText, health: usageHealth(percent) }
}

function modelName(label: string): string | null {
  const match = label.match(/current week\s*\(([^)]+)\)/i)
  if (!match || /all models/i.test(match[1])) return null
  return match[1].replace(/\bonly\b/gi, '').trim().split(/\s+/)[0]?.toLowerCase() ?? null
}

function detectPlan(text: string): string | null {
  if (/·\s*claude\s+pro/i.test(text)) return 'Claude Pro'
  if (/·\s*claude\s+max/i.test(text)) return 'Claude Max'
  return null
}

function extraUsage(text: string, now: number): AgentUsageCost | null {
  if (!/extra usage/i.test(text) || /extra usage not enabled/i.test(text)) return null
  const match = text.match(/\$?([\d,]+(?:\.\d+)?)\s*\/\s*\$?([\d,]+(?:\.\d+)?)\s*spent/i)
  if (!match) return null
  const spentUsd = Number(match[1].replace(/,/g, ''))
  const budgetUsd = Number(match[2].replace(/,/g, ''))
  const start = text.toLowerCase().indexOf('extra usage')
  const resetText = resetTextFrom(text.slice(start).split(/\r?\n/).slice(0, 10))
  return {
    source: 'extra_usage',
    spentUsd,
    budgetUsd,
    remainingUsd: Math.max(0, budgetUsd - spentUsd),
    resetsAt: parseClaudeReset(resetText, now),
    resetText,
    apiDurationSeconds: null,
    estimated: false,
  }
}

export function parseClaudeCostOutput(text: string, capturedAt = Date.now()): AgentProviderUsage {
  const costMatch = text.match(/total\s+cost:\s*\$?([\d,]+(?:\.\d+)?)/i)
  if (!costMatch) throw new UsageProcessError('parse_failure', 'Claude `/cost` output did not contain total cost.')
  const duration = text.match(/total\s+duration\s*\(api\):\s*([^\n\r]+)/i)?.[1] ?? ''
  const hours = Number(duration.match(/(\d+(?:\.\d+)?)\s*h/i)?.[1] ?? 0)
  const minutes = Number(duration.match(/(\d+(?:\.\d+)?)\s*m(?!s)/i)?.[1] ?? 0)
  const seconds = Number(duration.match(/(\d+(?:\.\d+)?)\s*s/i)?.[1] ?? 0)
  return {
    provider: 'claude',
    availability: 'available',
    health: 'unknown',
    plan: 'Claude API',
    account: null,
    quotas: [],
    cost: {
      source: 'cli_cost',
      spentUsd: Number(costMatch[1].replace(/,/g, '')),
      budgetUsd: null,
      remainingUsd: null,
      resetsAt: null,
      resetText: null,
      apiDurationSeconds: hours * 3_600 + minutes * 60 + seconds,
      estimated: false,
    },
    daily: null,
    capturedAt,
    stale: false,
    error: null,
  }
}

export function parseClaudeUsageOutput(
  text: string,
  capturedAt = Date.now(),
  account: ClaudeAccount = null,
): AgentProviderUsage {
  const classified = classifyClaudeOutput(text)
  if (classified === 'trust') throw new UsageProcessError('trust_failure', 'Claude requires trust for the usage probe directory.')
  if (classified === 'cost') throw new UsageProcessError('parse_failure', 'Claude account requires the `/cost` fallback.')
  if (classified) throw classified

  const lines = text.split(/\r?\n/)
  const sessionIndex = lines.findIndex((line) => /current session/i.test(line))
  if (sessionIndex < 0) throw new UsageProcessError('parse_failure', 'Claude usage output did not contain a current session.')
  const session = quotaFromSection('session', 'Session', section(lines, sessionIndex), capturedAt)
  if (!session) throw new UsageProcessError('parse_failure', 'Claude usage output did not contain a session percentage.')

  const weeklyIndex = lines.findIndex((line) => /current week\s*\(all models\)/i.test(line))
  const weekly = weeklyIndex >= 0 ? quotaFromSection('weekly', 'Weekly', section(lines, weeklyIndex), capturedAt) : null
  const weeklyReset = weekly ? { text: weekly.resetText, at: weekly.resetsAt } : null
  const models: AgentUsageQuota[] = []
  for (const [index, line] of lines.entries()) {
    const name = modelName(line)
    if (!name) continue
    const quota = quotaFromSection(`model:${name}`, name[0].toUpperCase() + name.slice(1), section(lines, index), capturedAt, weeklyReset)
    if (quota && !models.some((existing) => existing.id === quota.id)) models.push(quota)
  }
  const quotas = [session, ...(weekly ? [weekly] : []), ...models]
  return {
    provider: 'claude',
    availability: 'available',
    health: worstUsageHealth(quotas),
    plan: detectPlan(text),
    account,
    quotas,
    cost: extraUsage(text, capturedAt),
    daily: null,
    capturedAt,
    stale: false,
    error: null,
  }
}

export async function collectClaudeUsage(options: ClaudeUsageOptions): Promise<AgentProviderUsage> {
  const paths = claudePaths()
  const configFile = options.configFile ?? paths.configFile
  const claudeDir = options.claudeDir ?? paths.claudeDir
  const now = options.now ?? Date.now
  const runPty = options.runPty ?? capturePty
  await mkdir(options.probeDir, { recursive: true })
  const env = usageProcessEnv()
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  const run = (command: '/usage' | '/cost') =>
    runPty({
      command: 'claude',
      args: [command, '--allowed-tools', ''],
      cwd: options.probeDir,
      env,
      promptResponses: PROMPT_RESPONSES,
    })

  let result = await run('/usage')
  let classification = classifyClaudeOutput(result.output)
  if (classification === 'trust') {
    if (!(await trustClaudeProbeDirectory(configFile, options.probeDir))) {
      throw new UsageProcessError('trust_failure', 'Claude usage probe directory could not be safely trusted.')
    }
    result = await run('/usage')
    classification = classifyClaudeOutput(result.output)
    if (classification === 'trust') {
      throw new UsageProcessError('trust_failure', 'Claude still requested folder trust after the safe retry.')
    }
  }

  const capturedAt = now()
  const account = await readAccount(configFile)
  const provider =
    classification === 'cost'
      ? parseClaudeCostOutput((await run('/cost')).output, capturedAt)
      : parseClaudeUsageOutput(result.output, capturedAt, account)
  provider.account = account
  try {
    provider.daily = await analyzeClaudeDailyUsage(claudeDir, capturedAt)
  } catch {
    // Quota data remains useful when local history cannot be read.
  }
  return provider
}
