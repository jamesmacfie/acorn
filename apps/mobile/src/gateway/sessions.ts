import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Phone sessions, one file per session under the gateway's own directory. A file is named by the hash
// of its session ID, so the directory holds nothing a browser could present. It records a label and
// when the session started; its modification time is when the session was last used.
//
// Use touches the file's time rather than rewriting it. `gateway revoke` runs in another process and
// deletes the file, and a touch can't bring a deleted file back the way a rewrite in flight could.

export type SessionInfo = { id: string; label: string; createdAt: number; lastUsedAt: number }

export type SessionStore = ReturnType<typeof sessionStore>

const ID_LENGTH = 12
const LABEL_MAX = 80

const hashOf = (sessionId: string): string => createHash('sha256').update(sessionId).digest('hex')

// The part of a user agent that names the device, such as "iPhone; CPU iPhone OS 18_0 like Mac OS X".
const labelFrom = (userAgent: string | undefined): string =>
  ((userAgent && /\(([^)]+)\)/.exec(userAgent)?.[1]) || userAgent || 'Unknown browser')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, LABEL_MAX)

export function sessionStore(dir: string) {
  const fileOf = (hash: string): string => join(dir, `${hash}.json`)

  return {
    /** Starts a session and returns its ID, the cookie's value. Only its hash is stored. */
    create(userAgent: string | undefined): string {
      const sessionId = randomBytes(32).toString('base64url')
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(fileOf(hashOf(sessionId)), JSON.stringify({ label: labelFrom(userAgent), createdAt: Date.now() }), {
        mode: 0o600,
        flag: 'wx',
      })
      return sessionId
    },

    /** The session's hash when the session is live, and marks it used. Null when it isn't. */
    use(sessionId: string): string | null {
      const hash = hashOf(sessionId)
      const now = new Date()
      try {
        utimesSync(fileOf(hash), now, now)
        return hash
      } catch {
        return null
      }
    },

    isLive: (hash: string): boolean => existsSync(fileOf(hash)),

    list(): SessionInfo[] {
      if (!existsSync(dir)) return []
      return readdirSync(dir)
        .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
        .flatMap((name) => {
          try {
            const { label, createdAt } = JSON.parse(readFileSync(join(dir, name), 'utf8')) as SessionInfo
            return [{ id: name.slice(0, ID_LENGTH), label, createdAt, lastUsedAt: statSync(join(dir, name)).mtimeMs }]
          } catch {
            return [] // revoked between the listing and the read
          }
        })
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    },

    /** Ends the session whose listed ID this is. False when no session has it. */
    revoke(id: string): boolean {
      if (id.length !== ID_LENGTH || !/^[0-9a-f]+$/.test(id) || !existsSync(dir)) return false
      const name = readdirSync(dir).find((file) => file.startsWith(id) && file.endsWith('.json'))
      if (!name) return false
      rmSync(join(dir, name), { force: true })
      return true
    },
  }
}
