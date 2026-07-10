import { EncryptJWT, jwtDecrypt } from 'jose'

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

// SESSION_ENC_KEY is 64 hex chars = 32 bytes, the key size A256GCM requires.
function keyBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('SESSION_ENC_KEY must be 64 hex chars (32 bytes); run `openssl rand -hex 32`')
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

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

// Encrypt/decrypt a single secret string at rest (integration tokens) — JWE A256GCM, same key as
// the session. No expiry: an integration credential lives until the user disconnects it.
export async function encryptSecret(plaintext: string, hexKey: string): Promise<string> {
  return new EncryptJWT({ s: plaintext }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).encrypt(keyBytes(hexKey))
}
export async function decryptSecret(jwt: string, hexKey: string): Promise<string | null> {
  try {
    const { s } = (await jwtDecrypt(jwt, keyBytes(hexKey))).payload as { s?: string }
    return s ?? null
  } catch {
    return null
  }
}

// The server is always plain-HTTP loopback (http://127.0.0.1:4317), so the `__Host-` prefix
// (which requires Secure/https) can never apply — `session` is the only cookie name.
// See docs/authentication.md.
export const SESSION_COOKIE = 'session'
