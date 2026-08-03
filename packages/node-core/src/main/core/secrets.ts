// Use-scoped secret access (docs/vNext/security.md § Secrets: "Plugins get use-scoped access… No
// getSecret() free-for-all, and credentials never appear in logs, events, error bodies, or client
// payloads").
//
// Before this, `decryptSecret(row.authRef, c.env.SESSION_ENC_KEY)` appeared at six sites across core
// and three plugins, each handing the plaintext to a caller that then owned it — and each site was a
// place SESSION_ENC_KEY itself was in scope.
//
// The guarantee this actually enforces, and the one worth having: a secret used inside `use()` cannot
// leak through the FAILURE path. Providers echo credentials back in error bodies (GitHub includes the
// token in some malformed-header responses), and those bodies get logged, wrapped in an ApiError, and
// sometimes returned to the client. `use()` scrubs the plaintext out of anything thrown from its own
// scope, so a provider that echoes gets redacted at the one boundary that sees both.
//
// What it deliberately does NOT do: prevent a caller from returning the plaintext out of `use()`.
// TypeScript cannot express that, and pretending otherwise with a branded wrapper would add ceremony
// without the property. The containment that matters — an AGENT reaching a credential at all — is
// closed by internal-token scoping (W7), not by this shape.
import { decryptSecret, encryptSecret } from '../../server/secretBox'

export class SecretUnavailableError extends Error {
  constructor(readonly purpose: string) {
    // Never includes the ref: a JWE is not plaintext, but it is the ciphertext, and error bodies are
    // the wrong place for it.
    super(`No usable credential for ${purpose}.`)
    this.name = 'SecretUnavailableError'
  }
}

// Replace every occurrence of each plaintext with a marker. Short strings are skipped: redacting a
// 3-character secret out of prose would mangle unrelated text, and a credential that short is not
// one worth protecting by substring replacement.
const MIN_REDACTABLE = 8

export function redact(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_REDACTABLE) continue
    out = out.split(secret).join('[redacted]')
  }
  return out
}

function scrub(error: unknown, secrets: readonly string[]): unknown {
  if (!(error instanceof Error)) {
    return typeof error === 'string' ? redact(error, secrets) : error
  }
  // Mutate rather than re-wrap: callers branch on error CLASS (DockerCliError, BridgeError,
  // ApiError), and replacing the instance with a generic Error would change control flow to fix a
  // string.
  error.message = redact(error.message, secrets)
  if (error.stack) error.stack = redact(error.stack, secrets)
  const cause = (error as { cause?: unknown }).cause
  if (cause !== undefined) (error as { cause?: unknown }).cause = scrub(cause, secrets)
  return error
}

export class SecretService {
  constructor(private readonly hexKey: string) {}

  // `purpose` is what the owner would see in an audit row and what an error names. It is required so
  // that a read has a stated reason at the call site — the difference between `getSecret(ref)` and
  // "read the github credential to list pull requests".
  async use<T>(ref: string | null | undefined, purpose: string, fn: (plaintext: string) => T | Promise<T>): Promise<T> {
    const plaintext = ref ? await decryptSecret(ref, this.hexKey) : null
    if (!plaintext) throw new SecretUnavailableError(purpose)
    try {
      return await fn(plaintext)
    } catch (error) {
      throw scrub(error, [plaintext])
    }
  }

  // For callers that must distinguish "not connected" from "failed", which is the shape githubToken()
  // already relies on to converge never-connected and revoked onto one user-visible outcome.
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

  // Escape hatch for the call sites that hand a credential to a long-lived consumer whose lifetime
  // this scope cannot bracket (a pg pool, a driver's child-process env). Named to be greppable, and
  // every use of it is a place the scrub-on-throw guarantee does NOT apply.
  reveal(ref: string, purpose: string): Promise<string> {
    return this.use(ref, purpose, (plaintext) => plaintext)
  }
}
