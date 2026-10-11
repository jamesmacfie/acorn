import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  INTERNAL_TOKEN_LIFETIME_MS,
  mintInternalToken,
  renewInternalToken,
  verifyInternalToken,
  type InternalClaims,
  type InternalEnvFactory,
} from './internalTokens'
import { sessionCredentialPath } from './credentialFile'
import type { ActiveCredentials } from './activeCredentials'

const REFRESH_MS = INTERNAL_TOKEN_LIFETIME_MS / 4
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000

// A tmux environment cannot be changed after its process starts. Keep a node-owned file at a stable
// path for each session; the MCP and task CLI read it for every request. The file is scoped by its
// signed contents, not by its name. No HTTP route can renew it.
//
// Each file's token id is live in `active` while the file is the Node's: a session's latest token, or
// a child's until it's released (docs/security/credentials.md § Revoking a credential).
export function renewingInternalEnv(
  key: string,
  dataDir: string,
  baseEnv: () => Record<string, string>,
  active: ActiveCredentials,
): { internalEnv: InternalEnvFactory; dispose(): void } {
  const dir = join(dataDir, 'internal-credentials')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!lstatSync(dir).isDirectory()) throw new Error('Internal credential directory is not a directory.')
  chmodSync(dir, 0o700)
  const childFiles = new Map<string, InternalClaims>()
  // Each session file the Node owns, and the id of the token it wrote there.
  const sessionFiles = new Map<string, string>()

  const replace = (path: string, token: string) => {
    const temporary = join(dir, `.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, token, { mode: 0o600, flag: 'wx' })
      renameSync(temporary, path)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  // `adopt` is the first pass at start, which takes the session files a previous run left as live. A
  // later pass renews only files it owns, so a token copied back to a removed session's path is deleted.
  const refresh = (adopt: boolean) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.endsWith('.tmp')) {
        rmSync(join(dir, entry.name), { force: true })
        continue
      }
      if (entry.name.endsWith('.child')) {
        // A one-shot workflow child has no owner after a Node restart.
        if (!childFiles.has(join(dir, entry.name))) rmSync(join(dir, entry.name), { force: true })
        continue
      }
      if (!entry.name.endsWith('.token') || !entry.isFile()) continue
      const path = join(dir, entry.name)
      try {
        const owned = sessionFiles.get(path)
        if ((!owned && !adopt) || Date.now() - lstatSync(path).mtimeMs > RETAIN_MS) {
          rmSync(path)
          continue
        }
        // A token from before credential ids gets one here, because renewal mints with the same claims.
        const renewed = renewInternalToken(key, readFileSync(path, 'utf8'))
        const claims = renewed ? verifyInternalToken(key, renewed) : null
        if (
          !renewed ||
          claims?.scope !== 'task' ||
          !claims.taskId ||
          !claims.sessionId ||
          !claims.credentialId ||
          path !== sessionCredentialPath(dataDir, claims.taskId, claims.sessionId)
        )
          continue
        // A file rewritten with another token for the session isn't the Node's credential. Its id isn't
        // live, so it authenticates nothing, and renewing it would only extend a copy.
        if (owned && claims.credentialId !== owned) continue
        if (!owned) {
          sessionFiles.set(path, claims.credentialId)
          active.activate(claims.credentialId)
        }
        replace(path, renewed)
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
  refresh(true) // The signing key survives a restart, even if the old token expired while the Node was down.
  const timer = setInterval(() => refresh(false), REFRESH_MS)
  timer.unref()

  const internalEnv: InternalEnvFactory = (claims) => {
    const token = mintInternalToken(key, claims)
    const env: Record<string, string> = { ...baseEnv(), ACORN_API_TOKEN: token }
    if (claims.scope !== 'task') return env
    const minted = verifyInternalToken(key, token)!
    active.activate(minted.credentialId!)
    if (claims.sessionId) {
      const path = sessionCredentialPath(dataDir, claims.taskId!, claims.sessionId)
      // One live token per session. The process that held the previous one is gone or reads this file.
      active.revoke(sessionFiles.get(path))
      replace(path, token)
      sessionFiles.set(path, minted.credentialId!)
      env.ACORN_API_TOKEN_FILE = path
    } else {
      const path = join(dir, `${randomUUID()}.child`)
      replace(path, token)
      childFiles.set(path, minted)
      env.ACORN_API_TOKEN_FILE = path
    }
    return env
  }
  internalEnv.release = (env) => {
    const path = env.ACORN_API_TOKEN_FILE
    const claims = path ? childFiles.get(path) : undefined
    if (!path || !claims) return
    childFiles.delete(path)
    active.revoke(claims.credentialId)
    rmSync(path, { force: true })
  }
  internalEnv.revokeSession = ({ taskId, sessionId }) => {
    const path = sessionCredentialPath(dataDir, taskId, sessionId)
    active.revoke(sessionFiles.get(path))
    sessionFiles.delete(path)
    rmSync(path, { force: true })
  }
  return {
    internalEnv,
    dispose: () => {
      clearInterval(timer)
      for (const [path, claims] of childFiles) {
        active.revoke(claims.credentialId)
        rmSync(path, { force: true })
      }
      childFiles.clear()
    },
  }
}
