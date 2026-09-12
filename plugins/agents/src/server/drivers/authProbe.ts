import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { usageProcessEnv } from '../usage/processRunner'

const execFileAsync = promisify(execFile)
const claudeAuthStatusSchema = z.object({ loggedIn: z.boolean().optional() }).passthrough()

export async function probeCodexAuthentication(executable: string): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync(executable, ['login', 'status'], {
      env: usageProcessEnv(),
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

export async function probeClaudeAuthentication(executable: string): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync(executable, ['auth', 'status', '--json'], {
      env: usageProcessEnv(),
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    })
    const result = claudeAuthStatusSchema.safeParse(JSON.parse(stdout))
    return result.success ? result.data.loggedIn ?? null : null
  } catch {
    return null
  }
}
