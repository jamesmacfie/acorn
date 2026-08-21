import { type SecretService, SecretUnavailableError } from '@acorn/plugin-api/node'

export class HttpStorageError extends Error {}

// An empty field is stored empty rather than sealed (docs/http-client.md § Data model;
// docs/third-party/README.md § "http has moved"). Nothing distinguishes a sealed empty string from
// a value this node cannot decrypt, so this only fixes new writes: rows sealed by the old code stay
// unreadable.
const EMPTY = ''

export async function protectHttpValue(value: string, secrets: SecretService): Promise<string> {
  if (value === EMPTY) return EMPTY
  return secrets.seal(value)
}

// reveal(), not a broker call: this is the API panel's own saved data being handed back to the owner
// who typed it (docs/security.md § Credential handling: "The HTTP client is device-principal-only
// and does not expose encrypted request material to internal callers."). The router enforces the
// owner-invoked half by requiring a `device` principal.
export async function openHttpValue(value: string, encrypted: boolean, secrets: SecretService): Promise<string> {
  if (!encrypted) throw new HttpStorageError('Saved HTTP data has not been encrypted')
  // An empty stored value is an empty field. It is not a ciphertext, so it cannot be one that failed.
  if (value === EMPTY) return EMPTY
  try {
    return await secrets.reveal(value, 'http panel: saved request field')
  } catch (error) {
    if (error instanceof SecretUnavailableError) throw new HttpStorageError('Saved HTTP data could not be decrypted')
    throw error
  }
}
