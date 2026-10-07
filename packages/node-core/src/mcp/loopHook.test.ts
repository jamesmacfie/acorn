import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:https'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureCert } from '../server/transport/tls'

// The harness bridge program over a real process (docs/managed-agents/loop-hooks.md): it forwards the
// hook input with the task token, prints the Node's reply, and prints nothing and exits zero for every
// failure, because a bridged harness reads that as no decision. Set up like ./server.test.ts.

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ENTRY = resolve(appRoot, '../../apps/node/src/entries/loop-hook.ts')

const ambient = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('ACORN_') && key !== 'NODE_EXTRA_CA_CERTS'),
)

const run = (env: Record<string, string>, stdin: string): Promise<{ code: number | null; stdout: string }> =>
  new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ENTRY, '/v1/p/agents/loop-hook', 'agents.loopHook.v1', 'claude', 'PreToolUse'], {
      cwd: appRoot, env: { ...ambient, ...env }, stdio: ['pipe', 'pipe', 'inherit'],
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk })
    child.on('close', (code) => resolvePromise({ code, stdout }))
    child.stdin.end(stdin)
  })

describe('the harness bridge program', () => {
  let stub: Server
  let dataDir: string
  let emptyDir: string
  let caPath: string
  let answer: { status: number; body: unknown } = { status: 200, body: {} }
  const posts: { url: string; token: string; body: unknown }[] = []

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-loop-hook-'))
    emptyDir = mkdtempSync(join(tmpdir(), 'acorn-loop-hook-empty-'))
    const cert = ensureCert(dataDir)
    caPath = join(dataDir, 'tls', 'cert.pem')
    stub = createServer({ key: cert.keyPem, cert: cert.certPem }, (req, res) => {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        posts.push({ url: req.url ?? '', token: String(req.headers['x-acorn-internal'] ?? ''), body: JSON.parse(raw) })
        res.statusCode = answer.status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(answer.body))
      })
    })
    await new Promise<void>((done) => stub.listen(0, '127.0.0.1', done))
    const port = (stub.address() as { port: number }).port
    writeFileSync(join(dataDir, 'node.json'), JSON.stringify({ nodeId: 'n', createdAt: Date.now(), protocolVersion: 1, port }))
  })

  afterAll(() => {
    stub.close()
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(emptyDir, { recursive: true, force: true })
  })

  const env = () => ({ ACORN_DATA_DIR: dataDir, ACORN_API_TOKEN: 'task-token', NODE_EXTRA_CA_CERTS: caPath })
  const deny = '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no"}}'

  it('forwards the hook input with the task token and prints what the Node composed', async () => {
    answer = { status: 200, body: { version: 'agents.loopHook.v1', output: deny } }
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push --force' }, tool_use_id: 'toolu_1' }
    await expect(run(env(), JSON.stringify(input))).resolves.toEqual({ code: 0, stdout: deny })
    expect(posts.at(-1)).toEqual({
      url: '/v1/p/agents/loop-hook',
      token: 'task-token',
      body: { version: 'agents.loopHook.v1', harness: 'claude', event: 'PreToolUse', input },
    })
  }, 30_000)

  it('prints nothing and exits zero when the Node is stopped, errs, or the input is not JSON', async () => {
    const input = JSON.stringify({ tool_name: 'Bash' })
    await expect(run({ ...env(), ACORN_DATA_DIR: emptyDir }, input)).resolves.toEqual({ code: 0, stdout: '' })
    answer = { status: 500, body: { error: 'boom' } }
    await expect(run(env(), input)).resolves.toEqual({ code: 0, stdout: '' })
    await expect(run(env(), 'not json')).resolves.toEqual({ code: 0, stdout: '' })
  }, 60_000)
})
