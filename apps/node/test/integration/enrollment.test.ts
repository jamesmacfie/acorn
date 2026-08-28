import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { startControlPlaneStub, type ControlPlaneStub } from '@acorn/node-core/testkit/controlPlaneStub.ts'

// A real node, booted with the two environment variables set, enrolling with the fifty-line stub
// (docs/node-enrollment.md).
//
// The phase's acceptance wording is "a node booted in a container", and the container is the Docker
// image docs/future/bundle.md owns and which does not exist yet. A spawned standalone entry is the same
// node with the same boot path, so this is that test with one fewer layer; when the image lands, it
// should run this same pair of assertions from inside it.
//
// Two cases, and the second is the one that protects every existing install: with both variables set
// the node appears in the stub's inventory, and with neither it writes nothing about a control plane at
// all.

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const READY_BUDGET_MS = 90_000

type Handshake = { nodeId: string; endpoint: string; fingerprint: string; deviceToken: string }

function startNode(dataDir: string, extra: Record<string, string> = {}): { child: ChildProcess; ready: Promise<Handshake> } {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/standalone.ts'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ACORN_DATA_DIR: dataDir,
      SESSION_ENC_KEY: '0'.repeat(64),
      GITHUB_CLIENT_ID: 'test-client',
      ACORN_PORT: '',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ignore'],
  })
  child.stderr?.on('data', (chunk: Buffer) => console.error(`[standalone] ${chunk.toString().trimEnd()}`))
  const ready = new Promise<Handshake>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('standalone printed no handshake line')), READY_BUDGET_MS)
    timer.unref?.()
    let buffered = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString()
      // The handshake is one line of JSON among free-form logging, so scan lines rather than assuming it
      // arrives first or alone (standaloneShutdown.test.ts says the same).
      for (const line of buffered.split('\n')) {
        try {
          const parsed = JSON.parse(line) as Partial<Handshake>
          if (parsed.nodeId && parsed.endpoint && parsed.deviceToken) {
            clearTimeout(timer)
            resolveReady(parsed as Handshake)
            return
          }
        } catch {
          // not the contract line
        }
      }
      buffered = buffered.slice(buffered.lastIndexOf('\n') + 1)
    })
    child.once('exit', (code) => reject(new Error(`standalone exited (${code}) before it was listening`)))
  })
  return { child, ready }
}

const stop = (child: ChildProcess): Promise<void> =>
  new Promise((done) => {
    const timer = setTimeout(() => done(), 25_000)
    timer.unref?.()
    child.once('exit', () => {
      clearTimeout(timer)
      done()
    })
    child.kill('SIGTERM')
  })

const identityOf = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, 'node.json'), 'utf8')) as Record<string, unknown>

describe('a standalone node enrolling with a control plane', () => {
  let child: ChildProcess | null = null
  let dataDir: string | null = null
  let stub: ControlPlaneStub | null = null

  afterEach(async () => {
    if (child) await stop(child)
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
    const node = startNode(dataDir, { ACORN_ENROLLMENT_TOKEN: 'provisioned-once', ACORN_CONTROL_PLANE_URL: stub.url })
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
    const node = startNode(dataDir)
    child = node.child
    await node.ready

    // The open-source promise, asserted: no account, no control plane, fully working node.
    const identity = identityOf(dataDir)
    expect(identity.attachment).toBeUndefined()
    expect(identity.enrollmentError).toBeUndefined()
    expect(stub.inventory()).toEqual([])
  }, 180_000)
})
