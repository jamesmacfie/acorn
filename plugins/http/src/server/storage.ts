import { type SecretService, SecretUnavailableError } from '@acorn/plugin-api/node'

export class HttpStorageError extends Error {}

// An empty field is stored empty rather than sealed, and this is a FIX rather than an optimisation.
//
// `SecretService.use` treats an empty plaintext as "no usable credential" and throws — correctly, for a
// credential: a missing reference and a blank one are the same nothing. But these are not credentials, they
// are a saved request's fields, and "" is an ordinary value for most of them. A GET with no body is the
// default shape of a new request, so sealing "" meant every such request was written successfully and then
// threw a 500 on the way back out, from `openHttpValue` → `reveal` → `use`.
//
// Nothing distinguishes a sealed empty string from a value this node cannot decrypt at all, because both
// arrive as the same refusal — so this fixes it going forward and cannot repair rows the old code already
// wrote. Those were unreadable before this change and remain unreadable after it; what changes is that new
// saves work. Found while moving this plugin to the loaded tier (docs/third-party/README.md § "http has moved"), by a test that
// posted a request without a body — which every fixture in this package's own suite happened to fill in.
const EMPTY = ''

export async function protectHttpValue(value: string, secrets: SecretService): Promise<string> {
  if (value === EMPTY) return EMPTY
  return secrets.seal(value)
}

// reveal(), and deliberately so: this is the API panel's OWN saved data being handed back to the
// owner who typed it. docs/security.md § Secrets names that exemption explicitly ("The
// user-facing HTTP client pane is exempt by design… but is owner-invoked only"), and the router
// enforces the owner-invoked half by requiring a `device` principal.
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
