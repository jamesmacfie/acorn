import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { PairedDevice } from '@acorn/protocol/node.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { recordAudit, type AuditActor } from '../audit'

// Device tokens: issue / authenticate / list / revoke (docs/api-reference.md § Pairing).
//
// The raw token is returned exactly once, at pairing; only sha256(secret) is stored. A 256-bit
// random secret makes offline hash guessing infeasible, so nothing reversible is layered on.
//
// Every paired device has full owner authority, disclosed at pairing. Device revocation is the
// lifecycle control; there are no per-token scopes because this is single-owner software.

// acorn_dt_<uuid>_<base64url(32 bytes)>. Anchored, so trailing garbage or whitespace is rejected
// rather than trimmed into a valid-looking token.
const TOKEN_RE = /^acorn_dt_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/

const LAST_SEEN_THROTTLE_MS = 5 * 60_000

const sha256 = (input: string): Buffer => createHash('sha256').update(input).digest()

// The wire shape lives in @acorn/protocol because the device list is an owner-facing response
// (GET /v2/core/devices); this alias keeps the name every call site here already uses.
export type DeviceSummary = PairedDevice

export type IssuedDevice = { token: string; device: DeviceSummary }

export type DeviceService = {
  issue(name: string): Promise<IssuedDevice>
  // Resolves a raw bearer to a device id, or null. See the uniform-null note on the implementation.
  authenticate(bearer: string | undefined): Promise<{ deviceId: string } | null>
  list(): Promise<DeviceSummary[]>
  // True if the device existed (whether or not it was already revoked); false if it never existed,
  // which is how a route decides between 204 and 404.
  //
  // `actor` is who to blame in the audit trail. Optional because the two non-route callers (a test, and
  // a node revoking on its own behalf) have no principal, and defaulting to 'system' is honest for them
  // — but a revoke that arrived over HTTP should say which device asked, because "which of my machines
  // unpaired this one?" is the question the trail exists to answer.
  revoke(id: string, actor?: AuditActor): Promise<boolean>
  // Fires after a successful revoke so live sockets for that device close immediately
  // (docs/api-reference.md § Pairing: "open sockets are closed").
  onRevoked(listener: (deviceId: string) => void): () => void
  // Is this device still allowed? The 60s stream re-check reads this rather than re-authenticating,
  // because a long-lived socket holds no bearer to re-present.
  isActive(id: string): Promise<boolean>
}

// The token a node's own launcher should use: reuse the one it remembered when it still
// authenticates, and issue a fresh one otherwise (first run, a reset data root, or a device the owner
// revoked). Shared by the two things that boot a node — the Electron supervisor, which passes the
// token back from the OS keychain (apps/node/src/service/runtime.ts), and the standalone entry, which
// takes it from ACORN_DEVICE_TOKEN. Without the reuse each launch would add a device row.
//
// The node never persists the result: custody belongs to whoever started it.
export async function resolveDeviceToken(devices: DeviceService, remembered: string | undefined, name: string): Promise<string> {
  if (remembered && (await devices.authenticate(remembered))) return remembered
  const { token } = await devices.issue(name)
  return token
}

const summarize = (row: typeof schema.devices.$inferSelect): DeviceSummary => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  lastSeenAt: row.lastSeenAt,
  revokedAt: row.revokedAt,
})

export function deviceService(db: AppDatabase, now: () => number = () => Date.now()): DeviceService {
  const revokeListeners = new Set<(deviceId: string) => void>()

  return {
    async issue(name) {
      const id = randomUUID()
      const secret = randomBytes(32).toString('base64url') // 43 chars, unpadded
      const createdAt = now()
      await db.insert(schema.devices).values({ id, name, secretHash: sha256(secret), createdAt, lastSeenAt: null, revokedAt: null })
      // The actor is 'system': whoever holds the pairing code is by definition not yet a device, and the
      // bundled local node pairs with no code at all because the client spawned it. The NAME is the only
      // thing the owner will have to recognise this row by, so it goes in the details.
      recordAudit(db, { actor: 'system', action: 'device.paired', subject: id, details: { name } })
      return {
        token: `acorn_dt_${id}_${secret}`,
        device: { id, name, createdAt, lastSeenAt: null, revokedAt: null },
      }
    },

    // Missing, malformed, unknown, revoked and wrong-secret ALL return null. That uniformity is the
    // point: distinguishing them would turn this into a token-status oracle, letting a caller learn
    // that an id exists or that a token was revoked rather than never valid.
    async authenticate(bearer) {
      if (!bearer) return null
      const match = TOKEN_RE.exec(bearer)
      if (!match) return null
      const [, id, secret] = match

      const [row] = await db.select().from(schema.devices).where(eq(schema.devices.id, id)).limit(1)
      if (!row) return null
      if (row.revokedAt !== null) return null

      const presented = sha256(secret)
      const stored = row.secretHash as unknown as Buffer
      // Length check first: timingSafeEqual throws on a mismatch rather than returning false, and a
      // stored hash is always 32 bytes unless the row is corrupt.
      if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) return null

      const at = now()
      if (row.lastSeenAt === null || at - row.lastSeenAt >= LAST_SEEN_THROTTLE_MS) {
        // Fire-and-forget: last-seen is telemetry for the device list, so a write failure must not
        // fail authentication or add latency to the request path.
        void (async () => {
          try {
            await db.update(schema.devices).set({ lastSeenAt: at }).where(eq(schema.devices.id, id))
          } catch {
            // best-effort
          }
        })()
      }

      return { deviceId: id }
    },

    async list() {
      const rows = await db.select().from(schema.devices)
      return rows.sort((a, b) => b.createdAt - a.createdAt).map(summarize)
    },

    async revoke(id, actor = { actor: 'system' as const }) {
      const [row] = await db.select({ id: schema.devices.id, revokedAt: schema.devices.revokedAt }).from(schema.devices).where(eq(schema.devices.id, id)).limit(1)
      if (!row) return false
      if (row.revokedAt === null) {
        await db.update(schema.devices).set({ revokedAt: now() }).where(eq(schema.devices.id, id))
        // Only on the transition. A repeat revoke still notifies listeners below (a reconnect racing the
        // first one has to be closed too), but it is not a second security event to review.
        recordAudit(db, { ...actor, action: 'device.revoked', subject: id })
      }
      // Notify even on a repeat revoke: it is cheap, and a socket that survived the first one (a
      // reconnect racing the revoke) must still be closed.
      for (const listener of revokeListeners) listener(id)
      return true
    },

    onRevoked(listener) {
      revokeListeners.add(listener)
      return () => revokeListeners.delete(listener)
    },

    async isActive(id) {
      const [row] = await db.select({ revokedAt: schema.devices.revokedAt }).from(schema.devices).where(eq(schema.devices.id, id)).limit(1)
      return Boolean(row) && row.revokedAt === null
    },
  }
}
