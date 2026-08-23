// Use-scoped secret access (docs/security.md § Credential handling). `use()` scrubs the plaintext out
// of anything thrown from its own scope. It does not stop a caller returning the plaintext out of
// `use()`, which internal-token scoping closes instead.
import { decryptSecret, encryptSecret } from '../../../server/secretBox'

export class SecretUnavailableError extends Error {
  constructor(readonly purpose: string) {
    // Never include the ref. A JWE is not plaintext, but it is the ciphertext, and an error body is
    // the wrong place for it.
    super(`No usable credential for ${purpose}.`)
    this.name = 'SecretUnavailableError'
  }
}

// Replace every occurrence of each plaintext with a marker. Short strings are skipped, because
// redacting a 3-character secret out of prose mangles unrelated text.
const MIN_REDACTABLE = 8

export function redact(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_REDACTABLE) continue
    out = out.split(secret).join('[redacted]')
  }
  return out
}

// Mutate rather than re-wrap. Callers branch on the error's class, such as DockerCliError or
// ApiError, so replacing the instance with a generic Error would change control flow to fix a string.
//
// Every write is guarded. A frozen or sealed Error, or one whose `message` is a getter-only
// accessor, makes the assignment throw a TypeError whose own message embeds the original error's
// stringification, secret included, from inside this catch where no caller can recover it. Confirmed
// against `Object.freeze(new Error(...))`. When a field cannot be rewritten, a redacted plain Error
// replaces it: losing the class is bad, leaking the credential is worse.
//
// `seen` breaks a circular cause chain, which otherwise recursed until RangeError.
function scrub(error: unknown, secrets: readonly string[], seen: Set<unknown> = new Set()): unknown {
  if (!(error instanceof Error)) {
    return typeof error === 'string' ? redact(error, secrets) : error
  }
  if (seen.has(error)) return error
  seen.add(error)
  const message = redact(error.message, secrets)
  const stack = error.stack ? redact(error.stack, secrets) : undefined
  try {
    error.message = message
    if (stack !== undefined) error.stack = stack
  } catch {
    // Frozen, sealed, or getter-only. Fall back to a redacted copy rather than let the assignment's
    // own TypeError carry the plaintext out of this scope.
    const replacement = new Error(message)
    if (stack !== undefined) replacement.stack = stack
    return replacement
  }
  const cause = (error as { cause?: unknown }).cause
  if (cause !== undefined) {
    const scrubbed = scrub(cause, secrets, seen)
    try {
      ;(error as { cause?: unknown }).cause = scrubbed
    } catch {
      // A frozen cause chain is already scrubbed wherever it could be.
    }
  }
  return error
}

export class SecretService {
  constructor(private readonly hexKey: string) {}

  // `purpose` is what an audit row shows and what an error names. Required, so every read states a
  // reason at the call site: `getSecret(ref)` against "read the github credential to list pull
  // requests".
  async use<T>(ref: string | null | undefined, purpose: string, fn: (plaintext: string) => T | Promise<T>): Promise<T> {
    const plaintext = ref ? await decryptSecret(ref, this.hexKey) : null
    if (!plaintext) throw new SecretUnavailableError(purpose)
    try {
      return await fn(plaintext)
    } catch (error) {
      throw scrub(error, [plaintext])
    }
  }

  // For callers that have to tell "not connected" from "failed". githubToken() relies on this to
  // converge never-connected and revoked onto one user-visible outcome.
  async useOptional<T>(ref: string | null | undefined, purpose: string, fn: (plaintext: string) => T | Promise<T>): Promise<T | null> {
    try {
      return await this.use(ref, purpose, fn)
    } catch (error) {
      if (error instanceof SecretUnavailableError) return null
      throw error
    }
  }

  // Write path. Kept here so the key has exactly one holder.
  seal(plaintext: string): Promise<string> {
    return encryptSecret(plaintext, this.hexKey)
  }

  // Escape hatch for call sites that hand a credential to a long-lived consumer this scope cannot
  // bracket, such as a pg pool or a driver's child-process env. Named to be greppable: every use is
  // a place scrub-on-throw does not apply.
  reveal(ref: string, purpose: string): Promise<string> {
    return this.use(ref, purpose, (plaintext) => plaintext)
  }
}
