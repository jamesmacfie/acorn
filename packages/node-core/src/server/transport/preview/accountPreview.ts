import { accountPaths, previewResponseSchema, type PreviewResponse } from '@acorn/protocol/account.ts'

// The two account API routes a Node calls to serve previews (docs/account-api.md § Previews). They take
// the Node's relay credential, so a Node with Remote access on needs no signed-in person to renew.

const TIMEOUT_MS = 15_000

// Where previews are served, or null for a service with no preview domain.
export async function fetchPreview(accountUrl: string): Promise<PreviewResponse | null> {
  const response = await fetch(new URL(accountPaths.preview, accountUrl), { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`The account service answered ${response.status} for the preview domain.`)
  return previewResponseSchema.parse(await response.json())
}

// Publish the TXT record a certificate authority will look for. The service answers once it is served.
export async function publishChallenge(accountUrl: string, credential: string, value: string): Promise<void> {
  const response = await fetch(new URL(accountPaths.previewChallenge, accountUrl), {
    method: 'PUT',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`The account service answered ${response.status} to the DNS challenge.`)
}
