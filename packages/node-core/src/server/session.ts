import { EncryptJWT, jwtDecrypt } from 'jose'
import { keyBytes } from './secretBox'

// The stateless session: { token, user } sealed into an encrypted cookie (AES-256-GCM via
// JWE `dir`). Decrypted in-CPU on every /api/* request — no server-side session store.
// See docs/authentication.md.

export type SessionData = {
  token: string // GitHub OAuth token — NEVER returned to the browser in plaintext
  login: string
  name: string
  avatar: string
  scopes: string[]
}

export const SESSION_TTL_SECONDS = 604800 // 7 days; sliding (re-issued on each authed request)

export async function sealSession(data: SessionData, hexKey: string): Promise<string> {
  return new EncryptJWT({ ...data })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .encrypt(keyBytes(hexKey))
}

// Returns null on anything wrong (bad/expired/tampered) so callers treat it as "no session".
export async function openSession(jwt: string, hexKey: string): Promise<SessionData | null> {
  try {
    const { payload } = await jwtDecrypt(jwt, keyBytes(hexKey))
    const { token, login, name, avatar, scopes } = payload as Partial<SessionData>
    if (!token || !login) return null
    return { token, login, name: name ?? '', avatar: avatar ?? '', scopes: scopes ?? [] }
  } catch {
    return null
  }
}

// encryptSecret / decryptSecret moved to ./secretBox — they outlive this module, which exists only
// for the session cookie.

// The server is always plain-HTTP loopback (http://127.0.0.1:4317), so the `__Host-` prefix
// (which requires Secure/https) can never apply — `session` is the only cookie name.
// See docs/authentication.md.
export const SESSION_COOKIE = 'session'
