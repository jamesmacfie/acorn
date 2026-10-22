import { z } from 'zod'

// The public keys an account service signs with, as a JWKS (RFC 7517). A leaf module, because the
// Node's identity file stores them, and the rest of the account API must stay off a Node's boot.
export const accountKeysSchema = z.object({
  keys: z.array(
    z.object({ kty: z.literal('OKP'), crv: z.literal('Ed25519'), x: z.string().min(1), kid: z.string().min(1) }),
  ),
})
export type AccountKeys = z.infer<typeof accountKeysSchema>
