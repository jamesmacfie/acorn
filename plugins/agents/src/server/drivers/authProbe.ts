import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { usageProcessEnv } from '../usage/processRunner'

const execFileAsync = promisify(execFile)
const claudeAuthStatusSchema = z.object({ loggedIn: z.boolean().optional() }).passthrough()

export async function probeExecutableVersion(executable: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ['--version'], { timeout: 3_000, encoding: 'utf8' })
    return (stdout || stderr).trim().split(/\r?\n/)[0] || undefined
  } catch {
    return undefined
  }
}

// `env` points the CLI at one account's folder (docs/managed-agents/accounts.md).
export async function probeCodexAuthentication(
  executable: string,
  env: Record<string, string> = {},
): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync(executable, ['login', 'status'], {
      env: usageProcessEnv(env),
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    })
    if (/\bnot logged in\b/i.test(stdout)) return false
    if (/\blogged in\b/i.test(stdout)) return true
    return null
  } catch {
    return null
  }
}

export async function probeClaudeAuthentication(
  executable: string,
  env: Record<string, string> = {},
): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync(executable, ['auth', 'status', '--json'], {
      env: usageProcessEnv(env),
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    })
    const result = claudeAuthStatusSchema.safeParse(JSON.parse(stdout))
    return result.success ? (result.data.loggedIn ?? null) : null
  } catch {
    return null
  }
}

// Best effort: an account folder is deleted whether or not the CLI could sign it out first.
export async function signOut(executable: string, args: readonly string[], env: Record<string, string>): Promise<void> {
  await execFileAsync(executable, [...args], { env: usageProcessEnv(env), timeout: 10_000 }).catch(() => undefined)
}
