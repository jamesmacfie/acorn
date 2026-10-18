import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startControlPlaneStub, type ControlPlaneStub } from '@acorn/node-core/testkit'
import { startStandalone, stopStandalone } from '../../helpers/standalone'

// A real node, booted with the two environment variables set, enrolling with the fifty-line stub
// (docs/node-enrollment.md).
//
// A spawned standalone entry is the same node, with the same boot path, as the container image
// docs/future/bundle.md plans. When the image lands, it should run this same pair of assertions from
// inside it.
//
// Two cases, and the second is the one that protects every existing install: with both variables set
// the node appears in the stub's inventory, and with neither it writes nothing about a control plane at
// all.

const identityOf = (dataDir: string) =>
  JSON.parse(readFileSync(join(dataDir, 'node.json'), 'utf8')) as Record<string, unknown>

describe('a standalone node enrolling with a control plane', () => {
  let child: ChildProcess | null = null
  let dataDir: string | null = null
  let stub: ControlPlaneStub | null = null

  afterEach(async () => {
    if (child) await stopStandalone(child, 25_000)
    child?.kill('SIGKILL')
    child = null
    await stub?.close()
    stub = null
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    dataDir = null
  })

  it('appears in the inventory, and records what it is attached to', async () => {
    stub = await startControlPlaneStub({ tokens: ['provisioned-once'], name: 'Stub Cloud' })
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-enrolled-'))
    const node = startStandalone(dataDir, {
      ACORN_ENROLLMENT_TOKEN: 'provisioned-once',
      ACORN_CONTROL_PLANE_URL: stub.url,
    })
    child = node.child
    const handshake = await node.ready

    const [enrolled] = stub.inventory()
    expect(enrolled?.nodeId).toBe(handshake.nodeId)
    // The endpoint and fingerprint the node actually bound, not something a test invented: this is what
    // makes the control plane able to point a client at it and have the pin match.
    expect(enrolled?.endpoint).toBe(handshake.endpoint)
    expect(enrolled?.fingerprint).toBe(handshake.fingerprint)
    // A credential of its own, separate from the launcher's, so detaching revokes one thing.
    expect(enrolled?.deviceToken).not.toBe(handshake.deviceToken)

    expect(identityOf(dataDir).attachment).toMatchObject({
      controlPlaneUrl: `${stub.url}/`,
      controlPlaneName: 'Stub Cloud',
      deviceId: expect.any(String),
    })
  }, 180_000)

  it('writes nothing about a control plane when nobody provisioned it', async () => {
    stub = await startControlPlaneStub({ tokens: ['unused'] })
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-unenrolled-'))
    const node = startStandalone(dataDir)
    child = node.child
    await node.ready

    // The open-source promise, asserted: no account, no control plane, fully working node.
    const identity = identityOf(dataDir)
    expect(identity.attachment).toBeUndefined()
    expect(identity.enrollmentError).toBeUndefined()
    expect(stub.inventory()).toEqual([])
  }, 180_000)
})
