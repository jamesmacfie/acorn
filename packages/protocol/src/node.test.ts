import { describe, expect, it } from 'vitest'
import { NODE_PROTOCOL_VERSION, nodeIdentitySchema, nodeInfoSchema, pairRequestSchema, pairResultSchema } from './node'

// The compatibility contract, as assertions (docs/api-reference.md § Versioning).
//
// These schemas are the surface that decides whether two versions of acorn can talk at all, so what is
// pinned here is their tolerance. It is a property that is invisible until the day it is missing, and
// by then the client that needed it has shipped.

const FINGERPRINT = 'a'.repeat(64)

describe('the handshake tolerates a newer node', () => {
  // The case that broke: all three of these were strictObject, so the first field a future node added to
  // any of them made every older client report "did not answer like an acorn node".
  it('parses a node info response carrying fields it has never heard of', () => {
    const parsed = nodeInfoSchema.safeParse({
      protocolVersion: NODE_PROTOCOL_VERSION,
      fingerprint: FINGERPRINT,
      nodeId: 'node-1',
      // Whatever protocol 2.next adds.
      capabilities: ['dashboards'],
      region: 'home',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({ protocolVersion: NODE_PROTOCOL_VERSION, fingerprint: FINGERPRINT })
  })

  it('parses a pairing result carrying unknown fields, including on the nested device', () => {
    const parsed = pairResultSchema.safeParse({
      deviceToken: 'acorn_dt_x',
      nodeId: 'node-1',
      device: { id: 'd1', name: 'Laptop', createdAt: 1, lastSeenAt: null, revokedAt: null, platform: 'darwin' },
      issuedBy: 'owner',
    })
    expect(parsed.success).toBe(true)
  })

  it('still refuses a body that is missing what pairing actually needs', () => {
    // Tolerant of additions is not tolerant of anything: `fingerprint` is the identity a client pins
    // against, and an absent pin is the one thing that must never parse into a usable value.
    expect(nodeInfoSchema.safeParse({ protocolVersion: 2 }).success).toBe(false)
    expect(nodeInfoSchema.safeParse({ fingerprint: FINGERPRINT }).success).toBe(false)
  })

  it('keeps the pairing REQUEST strict, because a mutation is not a handshake', () => {
    // Rule 2: reads tolerate, mutations validate. This is the one route an unpaired caller can reach.
    expect(pairRequestSchema.safeParse({ code: '123456', deviceName: 'Laptop' }).success).toBe(true)
    expect(pairRequestSchema.safeParse({ code: '123456', deviceName: 'Laptop', admin: true }).success).toBe(false)
  })
})

describe('node.json survives its own history', () => {
  it('parses an identity file written before protocolVersion was retired', () => {
    // A root minted by an older acorn still has the key on disk. Under the strict schema this file used
    // to have, retiring the field would have made every existing data root unopenable.
    const parsed = nodeIdentitySchema.safeParse({
      nodeId: '00000000-0000-4000-8000-000000000000',
      createdAt: 1,
      protocolVersion: 2,
      port: 4317,
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).not.toHaveProperty('protocolVersion')
    expect(parsed.data?.port).toBe(4317)
  })
})
