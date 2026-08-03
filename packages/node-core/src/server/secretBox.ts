import { EncryptJWT, jwtDecrypt } from 'jose'

// Encryption at rest for single secret strings — integration credentials, HTTP-client fields,
// stored provider tokens. JWE A256GCM under SESSION_ENC_KEY, no expiry: an integration credential
// lives until the owner disconnects it.
//
// Split out of session.ts deliberately. SESSION_ENC_KEY predates vNext and its name says "session",
// but this is the part that OUTLIVES the session cookie: the cookie dies with the auth swap while
// every stored secret keeps riding this key. Keeping the two in one module meant four packages
// importing a session module purely for `encryptSecret`, and would have made the cookie's deletion
// look like it was taking the secret box with it.
//
// ponytail: docs/vNext/data.md calls this key `secrets.key`. Renaming it touches sessionKeyStore.ts,
// the docs, and every developer's .env for no behavioural gain, so the name stays for now.

// SESSION_ENC_KEY is 64 hex chars = 32 bytes, the key size A256GCM requires.
export function keyBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('SESSION_ENC_KEY must be 64 hex chars (32 bytes); run `openssl rand -hex 32`')
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export async function encryptSecret(plaintext: string, hexKey: string): Promise<string> {
  return new EncryptJWT({ s: plaintext }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).encrypt(keyBytes(hexKey))
}

// Returns null on anything wrong (bad key, tampered ciphertext) so callers treat it as "no secret"
// rather than having to distinguish failure modes they cannot act on differently.
export async function decryptSecret(jwt: string, hexKey: string): Promise<string | null> {
  try {
    const { s } = (await jwtDecrypt(jwt, keyBytes(hexKey))).payload as { s?: string }
    return s ?? null
  } catch {
    return null
  }
}
