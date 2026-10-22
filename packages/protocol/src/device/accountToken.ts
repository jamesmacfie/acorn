import type { z } from 'zod'
import type { AccountKeys } from './accountKeys.ts'
import { TOKEN_TYPES } from './account.ts'

// A signed account token is a compact JWS (RFC 7515) signed with Ed25519 (RFC 8037), the format a
// standard JWT library reads, so the hosted service and a third party's service can issue it with one.
// The header's `typ` says what the token is for, so a ticket can't be passed off as an assertion. This
// is the only place the format is written down, and it uses WebCrypto, which the relay, the Node, and
// a browser all have.

export type TokenType = keyof typeof TOKEN_TYPES
export type SigningKey = { kid: string; privateKey: CryptoKey }

const ALGORITHM = 'Ed25519'
const encoder = new TextEncoder()

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0))
const encodeJson = (value: unknown): string => toBase64Url(encoder.encode(JSON.stringify(value)))

export async function generateSigningKey(kid: string): Promise<{ signing: SigningKey; keys: AccountKeys }> {
  const pair = (await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify'])) as {
    publicKey: CryptoKey
    privateKey: CryptoKey
  }
  const { x } = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { signing: { kid, privateKey: pair.privateKey }, keys: { keys: [{ kty: 'OKP', crv: 'Ed25519', x: x!, kid }] } }
}

export async function signToken(type: TokenType, claims: object, key: SigningKey): Promise<string> {
  const signed = `${encodeJson({ alg: 'EdDSA', typ: TOKEN_TYPES[type], kid: key.kid })}.${encodeJson(claims)}`
  const signature = await crypto.subtle.sign(ALGORITHM, key.privateKey, encoder.encode(signed))
  return `${signed}.${toBase64Url(new Uint8Array(signature))}`
}

// The claims of a token of this type that one of `keys` signed, parsed by `schema` and not past its
// `exp`. Null for anything else, without saying why, because every reason is the same answer to the
// caller: not a token this service issued.
export async function verifyToken<Schema extends z.ZodType<object>>(
  token: string,
  type: TokenType,
  schema: Schema,
  keys: AccountKeys,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<z.infer<Schema> | null> {
  try {
    const [header, payload, signature, ...rest] = token.split('.')
    if (!header || !payload || !signature || rest.length) return null
    const head = JSON.parse(new TextDecoder().decode(fromBase64Url(header))) as {
      alg?: unknown
      typ?: unknown
      kid?: unknown
    }
    if (head.alg !== 'EdDSA' || head.typ !== TOKEN_TYPES[type]) return null
    const jwk = keys.keys.find((candidate) => candidate.kid === head.kid)
    if (!jwk) return null
    const publicKey = await crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['verify'])
    const valid = await crypto.subtle.verify(
      ALGORITHM,
      publicKey,
      fromBase64Url(signature),
      encoder.encode(`${header}.${payload}`),
    )
    if (!valid) return null
    const claims = schema.safeParse(JSON.parse(new TextDecoder().decode(fromBase64Url(payload))))
    if (!claims.success) return null
    const { exp } = claims.data as { exp?: unknown }
    return typeof exp === 'number' && exp <= nowSeconds ? null : claims.data
  } catch {
    return null
  }
}
