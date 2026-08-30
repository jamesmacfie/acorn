import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeAttachmentState } from '@acorn/protocol/api.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { deviceService } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { idempotencyStore } from '@acorn/node-core/server/auth/idempotency.ts'
import { mintInternalToken } from '@acorn/node-core/server/auth/internalTokens.ts'
import { pairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import { openDataRoot, readNodeAttachment, recordNodeAttachment, type DataRoot } from '@acorn/node-core/server/storage/dataRoot.ts'
import { makeTestDb, testSecretEnv, type TestDb } from '@acorn/node-core/testkit/db.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { Env } from '@acorn/node-core/server/bindings.ts'

// The attachment surface over the assembled app (docs/node-enrollment.md § Detaching).
//
// Detaching is the buy-back that makes the trust inversion acceptable, so the two things asserted here
// are that it really revokes the credential and that it really leaves the node alone. A hand-written
// attachment record stands in for an enrollment, which is exactly the phase's "done when": a node with
// a hand-written record shows it and can drop it.

const INTERNAL = 'internal-secret'
const ENC_KEY = '0'.repeat(64)

describe('the attachment record over HTTP', () => {
  let dir = ''
  let root: DataRoot | null = null
  let core: TestDb
  let env: Env
  let ownerToken = ''

  const call = (path: string, init: RequestInit = {}) => createApp().fetch(new Request(`http://127.0.0.1${path}`, init), env)
  const asOwner = (method = 'GET'): RequestInit => ({ method, headers: { authorization: `Bearer ${ownerToken}` } })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-attachment-'))
    root = openDataRoot(dir)
    core = makeTestDb()
    const devices = deviceService(core.db)
    ownerToken = (await devices.issue('test client')).token
    env = {
      DB: core.db,
      DATA_DIR: dir,
      NODE_ID: root.nodeId,
      APP_VERSION: 'test',
      NODE_FINGERPRINT: 'ff'.repeat(32),
      ...testSecretEnv(ENC_KEY),
      INTERNAL_TOKEN: INTERNAL,
      ACTIVE_IDENTITY: { get: () => 'james', set: () => {}, clear: () => {} },
      DEVICES: devices,
      IDEMPOTENCY: idempotencyStore(core.db),
      PAIRING_CODES: pairingCodes(),
      BLOBS: { get: async () => null, put: async () => {} },
    } as unknown as Env
  })

  afterEach(() => {
    root?.release()
    root = null
    core.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('says a node nobody provisioned is attached to nothing', async () => {
    const response = await call('/v2/core/attachment', asOwner())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ attachment: null, error: null } satisfies NodeAttachmentState)
    // Nothing to detach, and 404 rather than a silent 204: an owner clicking Detach on a node with no
    // attachment has misread something, and a cheerful success would confirm it.
    expect((await call('/v2/core/attachment', asOwner('DELETE'))).status).toBe(404)
  })

  it('shows a hand-written record, then drops it and revokes the credential', async () => {
    const controlPlaneDevice = await env.DEVICES.issue('Control plane (stub)')
    recordNodeAttachment(dir, {
      controlPlaneUrl: 'https://control.example/',
      attachedAt: 1_700_000_000_000,
      enrollmentTokenId: 'abc123abc123',
      deviceId: controlPlaneDevice.device.id,
    })

    const shown = (await (await call('/v2/core/attachment', asOwner())).json()) as NodeAttachmentState
    expect(shown.attachment).toMatchObject({ controlPlaneUrl: 'https://control.example/', enrollmentTokenId: 'abc123abc123' })

    expect((await call('/v2/core/attachment', asOwner('DELETE'))).status).toBe(204)
    // The credential the control plane held stops working immediately. This is the difference between
    // detaching and forgetting.
    expect(await env.DEVICES.authenticate(controlPlaneDevice.token)).toBeNull()
    expect(readNodeAttachment(dir).attachment).toBeUndefined()

    // And the node still is what it was. "A detached node keeps working" is the promise the whole
    // enrollment design rests on, so it is asserted rather than assumed.
    expect(root!.nodeId).toBe(env.NODE_ID)
    expect((await call('/v2/core/attachment', asOwner())).status).toBe(200)

    const trail = await core.db.select().from(schema.audit)
    expect(trail.map((row) => row.action)).toContain('node.detached')
  })

  it('is closed to a task-scoped agent', async () => {
    recordNodeAttachment(dir, {
      controlPlaneUrl: 'https://control.example/',
      attachedAt: 1_700_000_000_000,
      enrollmentTokenId: 'abc123abc123',
      deviceId: 'device-1',
    })
    const asAgent: RequestInit = { headers: { 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'task', taskId: 'task-1' }) } }
    const read = await call('/v2/core/attachment', asAgent)
    expect(read.status).toBe(403)
    // It names a control plane and a device row, which is reconnaissance, and the delete would revoke a
    // credential the owner set up.
    expect(await read.text()).not.toContain('control.example')
    expect((await call('/v2/core/attachment', { ...asAgent, method: 'DELETE' })).status).toBe(403)
    expect(readNodeAttachment(dir).attachment).toBeDefined()
  })
})
