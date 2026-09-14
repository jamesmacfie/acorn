// Use-scoped secret access (docs/security.md § Credential handling). `use()` scrubs the plaintext out
// of anything thrown from its own scope. It does not stop a caller returning the plaintext out of
// `use()`, which internal-token scoping closes instead.
import { decryptSecret, encryptSecret } from '../secretBox'
import { isSecretRef } from './onePassword'

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
  // `resolveRef` turns a 1Password reference into the value it points at (core/onePassword.ts). A
  // plain function rather than an injected interface: it needs a database handle and the owner id,
  // and that is the only reason it cannot live in this file. Optional so a test that only cares
  // about sealing and unsealing constructs the service with a key and nothing else.
  constructor(
    private readonly hexKey: string,
    private readonly resolveRef?: (ref: string) => Promise<string>,
  ) {}

  // `purpose` is what an audit row shows and what an error names. Required, so every read states a
  // reason at the call site: `getSecret(ref)` against "read the github credential to list pull
  // requests".
  async use<T>(ref: string | null | undefined, purpose: string, fn: (plaintext: string) => T | Promise<T>): Promise<T> {
    const stored = ref ? await decryptSecret(ref, this.hexKey) : null
    if (!stored) throw new SecretUnavailableError(purpose)
    // A stored credential may be a pointer at 1Password rather than the credential itself. Resolving
    // it here, rather than at each call site, is what makes every existing reader work unchanged.
    const plaintext = await this.resolve(stored)
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

  // A credential that is still in hand rather than sealed in the database: what someone just typed
  // into the connect form. Connect and rotate need it, because they have to validate the real token
  // before they store the reference to it.
  //
  // A failure throws OnePasswordError, deliberately not SecretUnavailableError. That distinction
  // carries: forEachConnection demotes a connection to needs-auth on the latter, and this is not
  // that. The connection is fine; this machine could not reach 1Password.
  async resolve(value: string): Promise<string> {
    return isSecretRef(value) && this.resolveRef ? await this.resolveRef(value) : value
  }

  // Write path. Kept here so the key has exactly one holder.
  seal(plaintext: string): Promise<string> {
    return encryptSecret(plaintext, this.hexKey)
  }

  // What backs this credential, without resolving it. The integrations list draws a 1Password badge
  // from this, and drawing a badge must never cost an unlock prompt. Local decryption only: it reads
  // the prefix and stops. Here rather than at the call site so the key keeps its one holder.
  async secretRef(ref: string | null | undefined): Promise<string | null> {
    const stored = ref ? await decryptSecret(ref, this.hexKey) : null
    return stored && isSecretRef(stored) ? stored : null
  }

  // Escape hatch for call sites that hand a credential to a long-lived consumer this scope cannot
  // bracket, such as a pg pool or a driver's child-process env. Named to be greppable: every use is
  // a place scrub-on-throw does not apply.
  reveal(ref: string, purpose: string): Promise<string> {
    return this.use(ref, purpose, (plaintext) => plaintext)
  }
}
