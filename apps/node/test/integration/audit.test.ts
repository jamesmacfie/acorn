import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '@acorn/node-core/server/index.ts'
import { deviceService } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { idempotencyStore } from '@acorn/node-core/server/auth/idempotency.ts'
import { pairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import { setPluginsBridge } from '@acorn/node-core/server/routes/plugins.ts'
import { makeTestDb, testSecretEnv, type TestDb } from '@acorn/node-core/testkit/db.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'

const ENC_KEY = '0'.repeat(64)

let harness: TestDb
let env: Env
let devices: ReturnType<typeof deviceService>
let deviceToken: string
let disabled: string[]

beforeEach(async () => {
  harness = makeTestDb()
  devices = deviceService(harness.db)
  deviceToken = (await devices.issue('owner laptop')).token
  disabled = []
  // The plugin toggle goes through a bridge, because the roster only exists once the composition root
  // has run the plugin host. Two plugins is enough to show the recorded list is the STATE, not a diff.
  setPluginsBridge({
    roster: () => [
      { name: 'docker', required: false, disabled: false },
      { name: 'http', required: false, disabled: false },
      { name: 'terminal', required: true, disabled: false },
    ],
    disabled: () => disabled,
    setDisabled: (names) => {
      disabled = [...names]
    },
  })
  env = {
    DB: harness.db,
    NODE_ID: 'node-1',
    APP_VERSION: 'test',
    NODE_FINGERPRINT: 'ff'.repeat(32),
    ...testSecretEnv(ENC_KEY),
    GITHUB_CLIENT_ID: 'client-id',
    GITHUB_CLIENT_SECRET: '',
    INTERNAL_TOKEN: 'internal-secret',
    ACTIVE_IDENTITY: { get: () => 'james', set: () => {}, clear: () => {} },
    DEVICES: devices,
    IDEMPOTENCY: idempotencyStore(harness.db),
    PAIRING_CODES: pairingCodes(),
    BLOBS: { get: async () => null, put: async () => {} },
  } as unknown as Env
})

afterEach(() => {
  setPluginsBridge(null as never)
  harness.cleanup()
})

const call = (path: string, init: RequestInit = {}) =>
  createApp().fetch(new Request(`http://127.0.0.1${path}`, init), env)

// Functions, not consts: `deviceToken` is minted per case in beforeEach, and a module-level const would
// capture the value from before the first one ran (i.e. undefined, i.e. a 401 on every request).
const bearer = () => ({ authorization: `Bearer ${deviceToken}` })
const asOwner = () => ({ ...bearer(), 'content-type': 'application/json' })
// acorn_dt_<uuid>_<secret>, and the uuid IS the device id (auth/deviceTokens.ts).
const ownerDeviceId = () => deviceToken.split('_')[2]

type Entry = { action: string; actor: string; actorId: string | null; subject: string | null; details: Record<string, unknown> | null; at: number }

// recordAudit is fire-and-forget so a logging failure cannot fail the action it describes; the row
// therefore lands a microtask after the response. Poll rather than sleep a fixed interval — this file
// runs beside 25 other packages (CLAUDE.md § the suite is load-sensitive).
async function entries(predicate: (rows: Entry[]) => boolean = (rows) => rows.length > 0): Promise<Entry[]> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const res = await call('/v2/core/audit', { headers: bearer() })
    expect(res.status).toBe(200)
    const rows = ((await res.json()) as { entries: Entry[] }).entries
    if (predicate(rows) || Date.now() > deadline) return rows
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('the audit trail records what security.md says it should', () => {
  it('already holds the pairing that created this device', async () => {
    // Written by deviceService.issue, not by a route — which is why it is here at all: the bundled local
    // node pairs with no code, so a route-only producer would miss the most common pairing on any
    // machine.
    const rows = await entries()
    expect(rows.map((row) => row.action)).toContain('device.paired')
    expect(rows.find((row) => row.action === 'device.paired')?.details).toMatchObject({ name: 'owner laptop' })
  })

  it('records a pairing window opening and closing', async () => {
    expect((await call('/v2/core/pair/start', { method: 'POST', headers: asOwner() })).status).toBe(200)
    expect((await call('/v2/core/pair', { method: 'DELETE', headers: asOwner() })).status).toBe(204)

    const rows = await entries((all) => all.some((row) => row.action === 'pairing.window.closed'))
    const opened = rows.find((row) => row.action === 'pairing.window.opened')
    expect(opened?.actor).toBe('device')
    // The requesting device, which is what makes "who opened a pairing window on my build box?"
    // answerable at all.
    expect(opened?.actorId).toBe(ownerDeviceId())
    expect(rows.some((row) => row.action === 'pairing.window.closed')).toBe(true)
    // The code is never recorded: a trail that quotes the credential is a second copy of it.
    expect(JSON.stringify(rows)).not.toContain('code')
  })

  it('records a revocation against the device that asked for it', async () => {
    const victim = await devices.issue('other machine')
    expect((await call(`/v2/core/devices/${victim.device.id}`, { method: 'DELETE', headers: asOwner() })).status).toBe(204)

    const rows = await entries((all) => all.some((row) => row.action === 'device.revoked'))
    const revoked = rows.find((row) => row.action === 'device.revoked')
    expect(revoked?.subject).toBe(victim.device.id)
    expect(revoked?.actorId).toBe(ownerDeviceId())
  })

  it('records a plugin toggle once, and not again for a no-op re-save', async () => {
    const put = (names: string[]) =>
      call('/v2/core/plugins', { method: 'PUT', headers: asOwner(), body: JSON.stringify({ disabled: names }) })

    expect((await put(['docker'])).status).toBe(200)
    await entries((all) => all.some((row) => row.action === 'plugins.disabled.changed'))
    // The client PUTs the whole list on every toggle, so a re-render re-saving what it already read must
    // not read as a second decision.
    expect((await put(['docker'])).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const rows = await entries()
    const changes = rows.filter((row) => row.action === 'plugins.disabled.changed')
    expect(changes).toHaveLength(1)
    expect(changes[0].details).toMatchObject({ disabled: 'docker' })
  })
})

describe('the trail is owner-readable and paged', () => {
  it('returns the most recent first with a cursor for the next page', async () => {
    for (let index = 0; index < 4; index += 1) {
      await call('/v2/core/pair/start', { method: 'POST', headers: asOwner() })
    }
    await entries((all) => all.filter((row) => row.action === 'pairing.window.opened').length >= 4)

    const res = await call('/v2/core/audit?limit=2', { headers: bearer() })
    const page = (await res.json()) as { entries: Entry[]; nextBefore: number | null }
    expect(page.entries).toHaveLength(2)
    expect(page.entries[0].at).toBeGreaterThanOrEqual(page.entries[1].at)
    expect(page.nextBefore).toBe(page.entries[1].at)

    const next = (await (await call(`/v2/core/audit?limit=2&before=${page.nextBefore}`, {
      headers: bearer(),
    })).json()) as { entries: Entry[] }
    // Strictly older, so the cursor cannot re-serve a row the first page already showed.
    for (const row of next.entries) expect(row.at).toBeLessThan(page.nextBefore!)
  })

  it('needs a credential at all', async () => {
    expect((await call('/v2/core/audit')).status).toBe(401)
  })
})
