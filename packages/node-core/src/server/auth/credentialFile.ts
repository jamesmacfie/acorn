import { createHash } from 'node:crypto'
import { join } from 'node:path'

// Stable across Node restarts and existing tmux shell environments. The name carries no authority;
// the signed token in the file still decides the task, session, and tool ceiling.
export function sessionCredentialPath(dataDir: string, taskId: string, sessionId: string): string {
  const name = createHash('sha256').update(`${taskId}\0${sessionId}`).digest('hex')
  return join(dataDir, 'internal-credentials', `${name}.token`)
}

export function credentialFileFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  if (env.ACORN_API_TOKEN_FILE) return env.ACORN_API_TOKEN_FILE
  if (env.ACORN_DATA_DIR && env.ACORN_TASK_ID && env.ACORN_SESSION_ID) {
    return sessionCredentialPath(env.ACORN_DATA_DIR, env.ACORN_TASK_ID, env.ACORN_SESSION_ID)
  }
  return undefined
}
