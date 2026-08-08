import { type SecretService, SecretUnavailableError } from '@acorn/plugin-api/node'

export class HttpStorageError extends Error {}

export async function protectHttpValue(value: string, secrets: SecretService): Promise<string> {
  return secrets.seal(value)
}

// reveal(), and deliberately so: this is the API panel's OWN saved data being handed back to the
// owner who typed it. docs/security.md § Secrets names that exemption explicitly ("The
// user-facing HTTP client pane is exempt by design… but is owner-invoked only"), and the router
// enforces the owner-invoked half by requiring a `device` principal.
export async function openHttpValue(value: string, encrypted: boolean, secrets: SecretService): Promise<string> {
  if (!encrypted) throw new HttpStorageError('Saved HTTP data has not been encrypted')
  try {
    return await secrets.reveal(value, 'http panel: saved request field')
  } catch (error) {
    if (error instanceof SecretUnavailableError) throw new HttpStorageError('Saved HTTP data could not be decrypted')
    throw error
  }
}
