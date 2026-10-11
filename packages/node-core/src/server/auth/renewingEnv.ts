import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { INTERNAL_TOKEN_LIFETIME_MS, mintInternalToken, renewInternalToken, verifyInternalToken, type InternalClaims, type InternalEnvFactory } from './internalTokens'
import { sessionCredentialPath } from './credentialFile'

const REFRESH_MS = INTERNAL_TOKEN_LIFETIME_MS / 4
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000

// A tmux environment cannot be changed after its process starts. Keep a node-owned file at a stable
// path for each session; the MCP and task CLI read it for every request. The file is scoped by its
// signed contents, not by its name. No HTTP route can renew it.
// `previousKey` re-mints files signed before a signing key rotation. Only the boot pass accepts it, so
// a leaked old key can't keep a forged file alive.
export function renewingInternalEnv(
  key: string,
  dataDir: string,
  baseEnv: () => Record<string, string>,
  previousKey?: string,
): { internalEnv: InternalEnvFactory; dispose(): void } {
  const dir = join(dataDir, 'internal-credentials')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!lstatSync(dir).isDirectory()) throw new Error('Internal credential directory is not a directory.')
  chmodSync(dir, 0o700)
  const childFiles = new Map<string, InternalClaims>()

  const replace = (path: string, token: string) => {
    const temporary = join(dir, `.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, token, { mode: 0o600, flag: 'wx' })
      renameSync(temporary, path)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  const refresh = () => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.endsWith('.tmp')) { rmSync(join(dir, entry.name), { force: true }); continue }
      if (entry.name.endsWith('.child')) {
        // A one-shot workflow child has no owner after a Node restart.
        if (!childFiles.has(join(dir, entry.name))) rmSync(join(dir, entry.name), { force: true })
        continue
      }
      if (!entry.name.endsWith('.token') || !entry.isFile()) continue
      const path = join(dir, entry.name)
      try {
        if (Date.now() - lstatSync(path).mtimeMs > RETAIN_MS) { rmSync(path); continue }
        const renewed = renewInternalToken(key, readFileSync(path, 'utf8'), previousKey)
        const claims = renewed ? verifyInternalToken(key, renewed) : null
        if (renewed && claims?.scope === 'task' && claims.taskId && claims.sessionId
          && path === sessionCredentialPath(dataDir, claims.taskId, claims.sessionId)) replace(path, renewed)
      } catch {
        // A deleted or unreadable file fails closed for its child. Other sessions still refresh.
      }
    }
    for (const [path, originalClaims] of childFiles) {
      try {
        const renewed = renewInternalToken(key, readFileSync(path, 'utf8'))
        const claims = renewed ? verifyInternalToken(key, renewed) : null
        // Compare every normalized claim, including the tool ceiling. A replacement token from
        // another task or child must not acquire this child's renewable lifetime.
        if (renewed && JSON.stringify(claims) === JSON.stringify(originalClaims)) replace(path, renewed)
      } catch {
        // A deleted file fails closed for its child; other children still refresh.
      }
    }
  }
  refresh() // The signing key survives a restart, even if the old token expired while the Node was down.
  previousKey = undefined
  const timer = setInterval(refresh, REFRESH_MS)
  timer.unref()

  const internalEnv: InternalEnvFactory = (claims) => {
    const token = mintInternalToken(key, claims)
    const env: Record<string, string> = { ...baseEnv(), ACORN_API_TOKEN: token }
    if (claims.scope === 'task' && claims.sessionId) {
      const path = sessionCredentialPath(dataDir, claims.taskId!, claims.sessionId)
      replace(path, token)
      env.ACORN_API_TOKEN_FILE = path
    } else if (claims.scope === 'task') {
      const path = join(dir, `${randomUUID()}.child`)
      replace(path, token)
      childFiles.set(path, verifyInternalToken(key, token)!)
      env.ACORN_API_TOKEN_FILE = path
    }
    return env
  }
  internalEnv.release = (env) => {
    const path = env.ACORN_API_TOKEN_FILE
    if (path && childFiles.delete(path)) rmSync(path, { force: true })
  }
  return {
    internalEnv,
    dispose: () => {
      clearInterval(timer)
      for (const path of childFiles.keys()) rmSync(path, { force: true })
      childFiles.clear()
    },
  }
}
