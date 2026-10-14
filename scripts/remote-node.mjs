#!/usr/bin/env node
// Start a Node in a Linux container and pair a `pnpm dev:agent` window to it, so a "remote Node" check
// runs against a different filesystem and network from the client's (docs/local-development.md
// § Test against a remote Node).

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { request } from 'node:https'
import { setTimeout as sleep } from 'node:timers/promises'
import { manifestPath, readJson, validateSessionName } from '../apps/desktop/scripts/agent/state.mjs'
import { WebDriverClient } from '../apps/desktop/scripts/agent/webdriver.mjs'

const USAGE = `Usage: pnpm dev:remote -- --session NAME

Packs the standalone Node, builds the acorn-node image, and runs it as the container acorn-remote-node
on https://localhost:4317 with a throwaway data volume. It seeds a Git project at /srv/projects/sample,
starts \`pnpm dev:agent -- --session NAME\`, and pairs that window to the container Node.

It prints one JSON line with the Node ID, label, and project when the window is paired. Stop the
window with \`pnpm dev:agent:ui -- --session NAME stop\` or press Ctrl-C, and the container goes too.

Agent credentials never go in the image. To run managed agent turns in the container, set any of
these in this shell first, and the container receives them: ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, OPENAI_API_KEY.
`

const ROOT = new URL('..', import.meta.url).pathname
const IMAGE = 'acorn-node'
const CONTAINER = 'acorn-remote-node'
// Fixed, and published at the same number, because the Node's Host check compares the port.
const PORT = 4317
const ENDPOINT = `https://localhost:${PORT}`
const LABEL = 'Container Node'
const PROJECT_PATH = '/srv/projects/sample'
// Passed by name only, so docker reads each value from this process and none lands on a command line.
const CREDENTIALS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY']

const log = (line) => console.log(`[remote-node] ${line}`)
const run = (command, args) => execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' })
// stderr is captured, not shown: the Node logs its boot there, and a failed command's error carries it.
const docker = (...args) => execFileSync('docker', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== '--')
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  const session = args[0] === '--session' && args.length === 2 ? args[1] : null
  if (!session) throw new Error(USAGE)
  return validateSessionName(session)
}

// The container prints its handshake as one JSON line, then a banner with the pairing code.
async function waitForBanner() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const logs = docker('logs', CONTAINER)
    const handshake = logs.split('\n').find((line) => line.startsWith('{"baseline"'))
    const code = /Pairing code\s+(\S+)/.exec(logs)?.[1]
    if (handshake && code) return { handshake: JSON.parse(handshake), code }
    await sleep(500)
  }
  throw new Error(`The container printed no pairing code within a minute. Read it with: docker logs ${CONTAINER}`)
}

// The handshake's launcher token can call the Node's API. The certificate is pinned to the one the
// handshake names, which is self-signed for the container's own name.
function postJson(handshake, path, body) {
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(path, ENDPOINT),
      {
        method: 'POST',
        ca: [handshake.certPem],
        checkServerIdentity: () => undefined,
        headers: {
          authorization: `Bearer ${handshake.deviceToken}`,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
      },
      (response) => {
        let text = ''
        response.on('data', (chunk) => (text += chunk))
        response.on('end', () =>
          response.statusCode < 300 ? resolve(JSON.parse(text)) : reject(new Error(`POST ${path}: ${response.statusCode} ${text}`)),
        )
      },
    )
    req.once('error', reject)
    req.end(payload)
  })
}

// A small Git repository at a path no Mac has, so a client path sent to this Node fails visibly.
async function seedProject(handshake) {
  docker('exec', '-u', 'root', CONTAINER, 'install', '-d', '-o', 'acorn', PROJECT_PATH)
  const script = [
    `cd ${PROJECT_PATH}`,
    'git init -q -b main',
    'printf "# Sample\\n\\nA project that exists only inside the container Node.\\n" > README.md',
    'git add README.md',
    'git -c user.name=acorn -c user.email=acorn@localhost commit -q -m "Initial commit"',
  ].join(' && ')
  docker('exec', CONTAINER, 'sh', '-c', script)
  const { project } = await postJson(handshake, '/v1/core/projects', { path: PROJECT_PATH })
  return project
}

async function waitForSession(name, agent, since) {
  while (agent.exitCode === null) {
    const manifest = await readJson(manifestPath(name)).catch(() => null)
    // A session already running under this name is not ours: dev:agent refuses it and exits.
    if (manifest?.status === 'ready' && Date.parse(manifest.startedAt) >= since) return manifest
    await sleep(1_000)
  }
  throw new Error(`pnpm dev:agent exited with ${agent.exitCode} before the window was ready.`)
}

// Pairs through the window's own fleet bridge, the calls Settings → Nodes makes: probe, then pair
// with the code. The probe's fingerprint must match the handshake's, which is the identity-words
// comparison a person would make.
async function pairWindow(manifest, handshake, code) {
  const client = new WebDriverClient(manifest.webdriverEndpoint, manifest.webdriverSessionId)
  const result = await client.request('POST', client.sessionPath('/execute/async'), {
    script: `const [endpoint, code, label, done] = arguments
      window.acorn.nodeProbe(endpoint)
        .then((probe) => window.acorn.nodePair({ code, deviceName: 'dev:agent', label }).then((node) => ({ probe, node })))
        .then(done, (error) => done({ error: String(error) }))`,
    args: [ENDPOINT, code, LABEL],
  })
  if (result?.error) throw new Error(`Pairing failed: ${result.error}`)
  const plain = (fingerprint) => fingerprint.replace(/:/g, '').toLowerCase()
  if (plain(result.probe.fingerprint) !== plain(handshake.fingerprint)) {
    throw new Error('The window reached a Node whose certificate differs from the container handshake.')
  }
  return result.node
}

async function main() {
  const session = parseArgs(process.argv.slice(2))

  log('packing the standalone Node')
  run('pnpm', ['pack:node'])
  log(`building the ${IMAGE} image`)
  run('docker', ['build', '-q', '-f', 'apps/node/Dockerfile', '-t', IMAGE, 'apps/node/release'])

  // The rig owns this name, so a container left from an earlier run is replaced.
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
  const credentials = CREDENTIALS.filter((name) => process.env[name])
  // --rm also removes the anonymous /data volume, which makes the data root throwaway.
  docker(
    'run', '-d', '--rm', '--name', CONTAINER, '-p', `${PORT}:${PORT}`, '-e', 'ACORN_ADVERTISE_HOST=localhost',
    ...credentials.flatMap((name) => ['-e', name]),
    IMAGE,
  )
  log(`container ${CONTAINER} started${credentials.length ? ` with ${credentials.join(', ')}` : ' with no agent credentials'}`)

  let agent = null
  const stop = () => {
    if (agent?.exitCode === null) agent.kill('SIGTERM')
    spawnSync('docker', ['stop', CONTAINER], { stdio: 'ignore' })
  }
  process.once('SIGINT', () => agent?.kill('SIGINT'))
  process.once('SIGTERM', () => agent?.kill('SIGTERM'))
  try {
    const { handshake, code } = await waitForBanner()
    const project = await seedProject(handshake)
    log(`seeded ${PROJECT_PATH} as project ${project.id}`)

    const since = Date.now()
    agent = spawn('pnpm', ['dev:agent', '--', '--session', session], { cwd: ROOT, stdio: 'inherit' })
    const manifest = await waitForSession(session, agent, since)
    const node = await pairWindow(manifest, handshake, code)
    log(`paired ${node.label} (${node.nodeId}) at ${ENDPOINT}`)
    console.log(JSON.stringify({ nodeId: node.nodeId, label: node.label, endpoint: ENDPOINT, projectId: project.id, projectPath: PROJECT_PATH }))

    await new Promise((resolve) => agent.once('exit', resolve))
  } finally {
    stop()
    log(`stopped ${CONTAINER}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
