import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deviceService } from './auth/deviceTokens'
import { makeTestDb, type TestDb } from '../testkit/db'
import { startControlPlaneStub, type ControlPlaneStub } from '../testkit/controlPlaneStub'
import { openDataRoot, readNodeAttachment, type DataRoot } from './storage/dataRoot'
import { checkControlPlaneUrl, enrollmentTokenId, enrollNode } from './enrollment'

// Unattended enrollment, end to end against the fifty-line stub (docs/node-enrollment.md).
//
// The property this file exists for, above all the others: with neither environment variable set,
// nothing happens. Everything else here is the behaviour of a node somebody deliberately provisioned.

const FINGERPRINT = 'a'.repeat(64)

describe('enrollNode', () => {
  let dir = ''
  let root: DataRoot | null = null
  let core: TestDb
  let stub: ControlPlaneStub | null = null

  const deps = (env: Record<string, string | undefined>) => ({
    dataDir: dir,
    nodeId: root!.nodeId,
    endpoint: 'https://node.example:4317',
    fingerprint: FINGERPRINT,
    devices: deviceService(core.db),
    db: core.db,
    env,
    // No real waiting: the retry's bound is what matters, not the wall clock.
    sleep: async () => {},
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-enrollment-'))
    root = openDataRoot(dir)
    core = makeTestDb()
  })

  afterEach(async () => {
    await stub?.close()
    stub = null
    root?.release()
    root = null
    core.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('does nothing at all when neither variable is set', async () => {
    const outcome = await enrollNode(deps({}))
    expect(outcome).toEqual({ kind: 'skipped', reason: 'unconfigured' })
    // Byte-for-byte: the file the data root wrote at open, untouched. This is the promise every
    // existing install depends on.
    expect(JSON.parse(readFileSync(join(dir, 'node.json'), 'utf8'))).toEqual({ nodeId: root!.nodeId, createdAt: expect.any(Number) })
    expect(await deviceService(core.db).list()).toEqual([])
  })

  it('posts the four fields, records the attachment, and appears in the stub inventory', async () => {
    stub = await startControlPlaneStub({ tokens: ['token-1'], name: 'Acorn Cloud' })
    const outcome = await enrollNode(deps({ ACORN_ENROLLMENT_TOKEN: 'token-1', ACORN_CONTROL_PLANE_URL: stub.url }))
    expect(outcome.kind).toBe('enrolled')

    const [enrolled] = stub.inventory()
    expect(enrolled).toEqual({
      protocolVersion: 1,
      nodeId: root!.nodeId,
      endpoint: 'https://node.example:4317',
      fingerprint: FINGERPRINT,
      deviceToken: expect.stringMatching(/^acorn_dt_/),
    })

    const record = readNodeAttachment(dir).attachment
    expect(record).toMatchObject({
      controlPlaneUrl: `${stub.url}/`,
      controlPlaneName: 'Acorn Cloud',
      enrollmentTokenId: enrollmentTokenId('token-1'),
    })
    // The credential the control plane now holds is a real device row on this node, so detaching has
    // something to revoke and the audit trail names it.
    const devices = await deviceService(core.db).list()
    expect(devices).toHaveLength(1)
    expect(record?.deviceId).toBe(devices[0]!.id)
    expect(await deviceService(core.db).authenticate(enrolled!.deviceToken)).toEqual({ deviceId: devices[0]!.id })
  })

  it('rides out a control plane still coming up, within its bound', async () => {
    // Two transient refusals, then an acknowledgement: a provisioner that starts the node beside the
    // service it enrolls with, which is the case the retry exists for.
    stub = await startControlPlaneStub({ tokens: ['token-1'], failFirst: 2 })
    const outcome = await enrollNode(deps({ ACORN_ENROLLMENT_TOKEN: 'token-1', ACORN_CONTROL_PLANE_URL: stub.url }))
    expect(outcome.kind).toBe('enrolled')
    expect(stub.inventory()).toHaveLength(1)
    expect(stub.rejections()).toHaveLength(2)
  })

  it('gives up after a bounded number of attempts, leaving no standing credential', async () => {
    stub = await startControlPlaneStub({ tokens: ['token-1'], failFirst: 99 })
    const outcome = await enrollNode(deps({ ACORN_ENROLLMENT_TOKEN: 'token-1', ACORN_CONTROL_PLANE_URL: stub.url }))
    expect(outcome.kind).toBe('failed')
    expect(readNodeAttachment(dir).enrollmentError?.reason).toContain('after 3 attempts')
    // A token nobody received must not stay valid: the device row this node issued for the handover is
    // revoked when the handover fails.
    const devices = await deviceService(core.db).list()
    expect(devices).toHaveLength(1)
    expect(devices[0]!.revokedAt).not.toBeNull()
  })

  it('records a visible failure rather than hanging when the control plane is not there', async () => {
    const outcome = await enrollNode(deps({ ACORN_ENROLLMENT_TOKEN: 'token-1', ACORN_CONTROL_PLANE_URL: 'http://127.0.0.1:1' }))
    expect(outcome.kind).toBe('failed')
    expect(readNodeAttachment(dir).attachment).toBeUndefined()
    expect(readNodeAttachment(dir).enrollmentError?.reason).toContain('could not enroll')
  })

  it('treats one variable without the other as a provisioning mistake', async () => {
    const outcome = await enrollNode(deps({ ACORN_ENROLLMENT_TOKEN: 'token-1' }))
    expect(outcome).toMatchObject({ kind: 'failed' })
    expect(readNodeAttachment(dir).enrollmentError?.reason).toContain('both')
  })

  it('enrolls once: a second boot with the same variables leaves the attachment alone', async () => {
    stub = await startControlPlaneStub({ tokens: ['token-1'] })
    await enrollNode(deps({ ACORN_ENROLLMENT_TOKEN: 'token-1', ACORN_CONTROL_PLANE_URL: stub.url }))
    const first = readNodeAttachment(dir).attachment

    const second = await enrollNode(deps({ ACORN_ENROLLMENT_TOKEN: 'token-1', ACORN_CONTROL_PLANE_URL: stub.url }))
    expect(second).toEqual({ kind: 'skipped', reason: 'already-attached' })
    expect(stub.inventory()).toHaveLength(1)
    expect(readNodeAttachment(dir).attachment).toEqual(first)
  })

  it('refuses to post a durable credential over plaintext to anything but loopback', async () => {
    expect(checkControlPlaneUrl('https://control.example')).toMatchObject({ url: expect.any(URL) })
    expect(checkControlPlaneUrl('http://127.0.0.1:9000')).toMatchObject({ url: expect.any(URL) })
    expect(checkControlPlaneUrl('http://control.example')).toMatchObject({ reason: expect.stringContaining('https') })
    expect(checkControlPlaneUrl('ftp://control.example')).toMatchObject({ reason: expect.stringContaining('http or https') })
    expect(checkControlPlaneUrl('not a url')).toMatchObject({ reason: expect.stringContaining('not a URL') })

    const outcome = await enrollNode(deps({ ACORN_ENROLLMENT_TOKEN: 'token-1', ACORN_CONTROL_PLANE_URL: 'http://control.example' }))
    expect(outcome).toMatchObject({ kind: 'failed' })
    // Refused before a device row exists, so a bad URL cannot cost the node a credential.
    expect(await deviceService(core.db).list()).toEqual([])
  })

  it('rejects a payload that does not match the published schema', async () => {
    // Not a test of the node: a test that the stub is checking, so the assertions above mean something.
    stub = await startControlPlaneStub({ tokens: ['token-1'] })
    const response = await fetch(`${stub.url}/enroll`, {
      method: 'POST',
      headers: { authorization: 'Bearer token-1', 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, nodeId: 'not-a-uuid', endpoint: 'https://x', fingerprint: 'short', deviceToken: '' }),
    })
    expect(response.status).toBe(400)
    expect(stub.inventory()).toEqual([])
  })
})
