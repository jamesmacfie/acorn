// Captures the shell snapshots: whole acorn windows, desktop and terminal, drawn by a running app on
// the site's fixture (docs/site/snapshots.md).
//
//   pnpm --filter @acorn/site snapshots              every scene
//   pnpm --filter @acorn/site snapshots hero palette  the scenes named
//
// It starts an isolated terminal session, desktop session, and browser session on the
// `site-snapshots` fixture, drives each to its scenes with the agent drivers, and writes
// src/generated/snapshots/<scene>.html or <scene>.cells.json. The drivers are run as commands, not
// imported, because apps never import each other. Every session is stopped and deleted at the end.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFakeGithub } from './fakeGithub.mjs'
import { privacyProblems } from './snapshotPrivacy.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SITE = join(ROOT, 'apps/site')
const OUT = join(SITE, 'src/generated/snapshots')
const FIXTURE = join(SITE, 'snapshots/fixture')
const DESKTOP_UI = join(ROOT, 'apps/desktop/scripts/agent/ui.mjs')
const TUI_UI = join(ROOT, 'apps/tui/scripts/agent/ui.mjs')
const EXTENSION_UI = join(ROOT, 'apps/extension/scripts/dev/ui.mjs')
const PAGE = readFileSync(join(SITE, 'scripts/shellPage.js'), 'utf8')
const WORLD = JSON.parse(readFileSync(join(FIXTURE, 'world.json'), 'utf8'))

// What every process the capture starts sees: UTC, so no time carries the machine's zone, the
// fixture's shell, so a terminal shows a fixed screen,
// stand-ins for the agent CLIs ahead of the real ones, so nothing reads a real account, and a Docker
// socket that doesn't exist, so no real container is listed.
const ENV = {
  ...process.env,
  TZ: 'UTC',
  SHELL: join(FIXTURE, 'shell.sh'),
  PATH: `${join(FIXTURE, 'bin')}:${process.env.PATH}`,
  DOCKER_HOST: `unix://${join(FIXTURE, 'no-docker.sock')}`,
}

// Each desktop scene is a list of steps, each run in the window after shellPage.js, which supplies
// `click`, `named`, `until`, `press`, `open`, `nodeFetch`, and `settle`. A step is handed the ids the
// fixture seeded, and runs in one driver call, which WebDriver gives about 30 seconds, so a long scene
// takes several. The last leaves the window showing the scene.
const DESKTOP = {
  hero: [
    async () => {
      await until(() => named('Retry failed webhooks'), 'the fixture tasks')
      await click('Retry failed webhooks')
      const panes = document.querySelector('nav[aria-label="Task panes"]')
      if (!named('Unpin Git')) {
        await click('Git', panes)
        await click('Pin Git')
      }
      await click('Agent', panes)
    },
    async () => {
      if (named('Collapse Agent list')) await click('Collapse Agent list')
      if (named('Collapse Git list')) await click('Collapse Git list')
      if (!document.querySelector('.xterm')) {
        await click('Terminal', document.querySelector('nav[aria-label="Task panes"]'))
        await click('New terminal')
        // The drawer's own New terminal button opens a menu of profiles.
        if (named('Shell')) await click('Shell')
        await until(() => document.querySelector('.xterm-rows')?.textContent.includes('passed'), 'the terminal output')
      }
    },
  ],
  palette: [
    async () => {
      await press('k', { metaKey: true })
      await until(() => document.querySelector('.palette'), 'the command palette')
    },
  ],
  permissions: [
    async () => {
      await press('Escape')
      await open('acorn://local/settings')
      await click('Installed')
      await click('Manage Database')
      await click('Permissions')
    },
  ],
  database: [
    async () => {
      if (named('Close settings')) await click('Close settings')
      await until(() => named('Speed up the overdue invoices query'), 'the fixture tasks')
      await click('Speed up the overdue invoices query')
      // The pane is offered once the Node says the task has a database, which takes a moment.
      await click('Database', document.querySelector('nav[aria-label="Task panes"]'))
    },
    async () => {
      await click('Run')
      await until(() => document.body.textContent.includes('INV-1042'), 'the query result')
    },
  ],
  review: [
    async ({ tasks }) => {
      // The Node answers GitHub through the capture's fake (./fakeGithub.mjs), which takes any token.
      await nodeFetch('POST', '/v1/core/integrations', { providerId: 'github', credentials: { accessToken: 'fixture' } })
      await open(`acorn://local/t/${tasks.vat}?pane=pr`)
      await until(() => document.body.textContent.includes('Should this check the customer'), 'the review thread')
    },
  ],
  workflow: [
    async ({ tasks, workflowId }) => {
      const { runId } = await nodeFetch('POST', `/v1/p/workflows/tasks/${tasks.vat}/workflows`, { defId: workflowId })
      await open(`acorn://local/t/${tasks.vat}?pane=workflows&item=${runId}`)
    },
    async () => {
      // The pane opens on the first step that ran, so pick the gate, which is waiting by now.
      const steps = () => [...document.querySelectorAll('[role="option"]')]
      ;(await until(() => steps().find((row) => row.textContent.startsWith('Release to staging?')), 'the gate step')).click()
      await until(() => named('Approve'), 'the gate')
      await click('Graph')
    },
  ],
  // The built-in plugin pages' panes, each on the webhooks task with nothing pinned beside it.
  notes: [
    async () => {
      if (named('Close settings')) await click('Close settings')
      await until(() => named('Retry failed webhooks'), 'the fixture tasks')
    },
    async ({ tasks }) => {
      await open(`acorn://local/t/${tasks.webhooks}?pane=notes`)
      if (named('Unpin Git')) await click('Unpin Git')
      await click('Plan')
      const body = () => [...document.querySelectorAll('textarea')].some((field) => field.value.includes('Retry 5xx'))
      await until(body, 'the plan note')
    },
  ],
  editor: [
    async ({ tasks }) => {
      await open(`acorn://local/t/${tasks.webhooks}?pane=editor`)
      await until(() => document.querySelector('[role="treeitem"]'), 'the file tree')
    },
    async () => {
      // A tree row is named by its path, then its Git status after a comma. A folder is open when a
      // row inside it shows.
      const paths = () =>
        [...document.querySelectorAll('[role="treeitem"]')]
          .filter(visible)
          .map((item) => [item.getAttribute('aria-label')?.split(',')[0], item])
      const row = (path) => paths().find(([name]) => name === path)?.[1]
      for (const folder of ['billing', 'billing/webhooks']) {
        const item = await until(() => row(folder), `the ${folder} folder`)
        if (!paths().some(([name]) => name?.startsWith(`${folder}/`))) {
          item.click()
          await settle()
        }
      }
      ;(await until(() => row('billing/webhooks/deliver.py'), 'the file')).click()
    },
    async () => {
      await until(() => document.querySelector('.cm-content')?.textContent.includes('def '), 'the file text')
    },
  ],
  context: [
    async ({ tasks }) => {
      await open(`acorn://local/t/${tasks.webhooks}?pane=context`)
      await until(() => document.body.textContent.includes('What the agent gets'), 'the context preview')
    },
  ],
  // Last, because once a second Node is paired every window shows which Node it's on.
  fleet: [
    async ({ secondNode }) => {
      await window.acorn.nodeProbe(secondNode.endpoint)
      await window.acorn.nodePair({ code: secondNode.code, deviceName: 'Studio', label: 'Build server' })
      await click('Fleet')
    },
  ],
}

// Each terminal scene is a list of driver steps: a key to press, a size, or text to wait for. The
// terminal session starts at 120 by 36 on the fixture's home screen, and the scenes run in order.
const TERMINAL = {
  'hero-terminal': [{ wait: 'Speed up the' }, { press: 'Tab' }, { press: 'Enter' }, { wait: 'One caller' }],
  'terminal-small': [{ resize: [80, 24] }, { press: 'Tab' }, { press: 'Right' }, { wait: 'Commit message' }],
}

const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
const captured = new Date().toISOString().slice(0, 10)

/** Run a driver command and hand back its output, failing loudly with the driver's own message. It
 *  runs alongside this process rather than blocking it, because the fake GitHub answers from here. */
function driver(script, session, args, input) {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [script, '--session', session, ...args], { cwd: ROOT, env: ENV })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.once('error', failed)
    child.once('exit', (code) =>
      code === 0 ? done(out) : failed(new Error(`${args[0]} failed: ${err.trim() || out.trim()}`)),
    )
    child.stdin.end(input)
  })
}

/** Start a launcher and wait for it to say `ready`. Its output goes to this terminal as it runs. */
function launch(command, args, env = {}) {
  return new Promise((ready, failed) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...ENV, ...env }, stdio: ['ignore', 'pipe', 'inherit'] })
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      if (/\] ready\b/.test(String(chunk))) ready(child)
    })
    child.once('exit', (code) => failed(new Error(`${command} ${args.join(' ')} exited with ${code} before it was ready.`)))
  })
}

/** Stop a session, wait for its launcher to finish, and delete what it kept. */
async function stop(script, session, child, directory) {
  const exited = new Promise((done) => child.once('exit', done))
  await driver(script, session, ['stop'])
  await exited
  rmSync(directory, { recursive: true, force: true })
}

function write(name, text) {
  writeFileSync(join(OUT, name), text)
  const problems = privacyProblems(text)
  for (const problem of problems) console.error(`${name}: ${problem}`)
  console.log(`Wrote ${name}${problems.length ? `, with ${problems.length} privacy problems` : ''}.`)
  return problems.length
}

/** A throwaway Postgres holding the fixture's billing database, for the Database pane. It needs
 *  PostgreSQL's own tools on PATH. */
async function startPostgres() {
  const directory = mkdtempSync(join(tmpdir(), 'acorn-snapshots-pg-'))
  const port = await freePort()
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8' })
    if (result.error?.code === 'ENOENT') throw new Error(`The database scene needs PostgreSQL's ${command} on PATH.`)
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim()}`)
  }
  const connection = ['-h', 'localhost', '-p', String(port), '-U', 'fernwood']
  run('initdb', ['-D', directory, '-U', 'fernwood', '--auth=trust', '--encoding=UTF8', '--locale=C'])
  run('pg_ctl', ['-D', directory, '-o', `-p ${port} -k ${directory} -c listen_addresses=localhost -c TimeZone=UTC`, '-l', join(directory, 'log'), '-w', 'start'])
  run('createdb', [...connection, 'billing'])
  run('psql', ['-q', '-v', 'ON_ERROR_STOP=1', ...connection, '-d', 'billing', '-f', join(FIXTURE, 'billing.sql')])
  return {
    url: `postgres://fernwood@localhost:${port}/billing`,
    stop: () => {
      run('pg_ctl', ['-D', directory, '-m', 'fast', 'stop'])
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

function freePort() {
  return new Promise((done, failed) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
    server.once('error', failed)
  })
}

/** The terminal session: the terminal client on its own Node, seeded with the same fixture. The fleet
 *  scene pairs the desktop with that Node as its second. */
async function startTerminal() {
  const session = `site-snapshots-${Date.now().toString(36)}`
  const args = ['--session', session, '--fixture', 'site-snapshots', '--cols', '120', '--rows', '36']
  const child = await launch(process.execPath, ['scripts/agent-tui.mjs', ...args])
  const directory = join(ROOT, '.acorn/agent-dev/tui', session)
  return { session, stop: () => stop(TUI_UI, session, child, directory), directory }
}

/** A pairing code from the terminal session's Node, asked for with that client's own device token. */
async function pairingCode({ directory }) {
  // The client keeps its token once its first frame is drawn, a moment after the session says ready.
  const tokenFile = join(directory, 'config/acorn-1-device-token-local')
  for (let waited = 0; !existsSync(tokenFile); waited += 250) {
    if (waited > 30_000) throw new Error('The terminal session never kept a device token.')
    await new Promise((done) => setTimeout(done, 250))
  }
  const { port } = JSON.parse(readFileSync(join(directory, 'data/node.json'), 'utf8'))
  const token = readFileSync(tokenFile, 'utf8').trim()
  const endpoint = `https://127.0.0.1:${port}`
  const response = await new Promise((done, failed) => {
    const request = httpsRequest(`${endpoint}/v1/core/pair/start`, {
      method: 'POST',
      ca: readFileSync(join(directory, 'data/tls/cert.pem')),
      headers: { authorization: `Bearer ${token}` },
    })
    request.once('response', async (answer) => done(JSON.parse(await text(answer))))
    request.once('error', failed)
    request.end()
  })
  return { endpoint, code: response.code }
}

const text = async (stream) => {
  let body = ''
  for await (const chunk of stream) body += chunk
  return body
}

async function captureDesktop(scenes, terminal) {
  const session = `site-snapshots-${Date.now().toString(36)}`
  const postgres = scenes.includes('database') ? await startPostgres() : null
  const github = scenes.includes('review') ? await startFakeGithub(WORLD) : null
  const env = { ...(postgres ? { DATABASE_URL: postgres.url } : {}), ...github?.env }
  let child
  let problems = 0
  try {
    child = await launch(
      'pnpm',
      ['--filter', '@acorn/desktop', 'dev:agent', '--', '--session', session, '--fixture', 'site-snapshots'],
      env,
    )
    const { fixture } = JSON.parse(await driver(DESKTOP_UI, session, ['status']))
    github?.serve(fixture.project)
    const ids = { ...fixture, ...(scenes.includes('fleet') ? { secondNode: await pairingCode(terminal) } : {}) }
    for (const scene of scenes) {
      for (const [index, step] of DESKTOP[scene].entries()) {
        console.log(`${scene}: step ${index + 1} of ${DESKTOP[scene].length}`)
        await driver(DESKTOP_UI, session, ['run'], `${PAGE}\nawait (${step})(${JSON.stringify(ids)})`)
      }
      const script = `${PAGE}\nawait settle()\nreturn capture(${JSON.stringify(scene)})`
      const html = JSON.parse(await driver(DESKTOP_UI, session, ['run'], script))
      problems += write(`${scene}.html`, `<!-- commit ${commit}, captured ${captured} -->\n${html}\n`)
    }
  } finally {
    if (child) await stop(DESKTOP_UI, session, child, join(ROOT, '.acorn/agent-dev', session))
    postgres?.stop()
    github?.stop()
    for (const request of github?.unanswered ?? []) console.warn(`The fake GitHub didn't answer ${request}.`)
  }
  return problems
}

/** Wait up to 20 seconds for the terminal to show `text`, then a second more for it to finish drawing. */
async function waitForText(session, text) {
  for (let waited = 0; !(await driver(TUI_UI, session, ['snapshot'])).includes(text); waited += 250) {
    if (waited > 20_000) throw new Error(`The terminal never showed "${text}".`)
    await new Promise((done) => setTimeout(done, 250))
  }
  await new Promise((done) => setTimeout(done, 1_000))
}

async function captureTerminal(scenes, { session }) {
  let problems = 0
  for (const scene of scenes) {
    for (const step of TERMINAL[scene]) {
      if (step.resize) await driver(TUI_UI, session, ['resize', ...step.resize.map(String)])
      else if (step.press) await driver(TUI_UI, session, ['press', step.press])
      else await waitForText(session, step.wait)
    }
    const cells = JSON.parse(await driver(TUI_UI, session, ['cells']))
    const lines = cells.lines.map((line) => JSON.stringify(line)).join(',\n')
    // One terminal row per line, as a specimen's cells are, so a recapture shows in review as the rows it moved.
    const text = `{"commit":"${commit}","captured":"${captured}","columns":${cells.columns},"rows":${cells.rows},"lines":[\n${lines}\n]}\n`
    problems += write(`${scene}.cells.json`, text)
  }
  return problems
}

/**
 * The browser scene: the extension's panel beside the pull request's page, in Chrome on a profile of
 * its own. The extension pairs with the terminal session's Node, so the panel knows the page's task.
 * The page itself is a labeled box, as a webview is in a desktop snapshot.
 */
async function captureBrowser(terminal) {
  const session = `site-snapshots-${Date.now().toString(36)}`
  const { endpoint, code } = await pairingCode(terminal)
  // The bridge looks for a Node in the data folder it's given, so it never reads a real one.
  const child = await launch(
    'pnpm',
    ['--filter', '@acorn/extension', 'dev', '--', '--browser', 'chrome', '--session', session, '--node', endpoint],
    { ACORN_DATA_DIR: join(terminal.directory, 'data') },
  )
  const panel = (...args) => driver(EXTENSION_UI, session, args)
  try {
    await panel('open')
    await panel('click', 'Use another address ›')
    await panel('fill', 'address', endpoint)
    await panel('click', 'Check identity')
    await panel('check', 'confirm')
    await panel('click', 'Continue')
    await panel('fill', 'pairing-code', code)
    await panel('fill', 'label', WORLD.workspace)
    await panel('click', 'Pair')
    await panel('click', 'Done')
    const [owner, name] = new URL(WORLD.projects[0].remote).pathname.replace(/\.git$/, '').slice(1).split('/')
    const page = `github.com/${owner}/${name}/pull/${WORLD.pull.number}`
    await panel('panel', `https://${page}`)
    const sidebar = await panel('eval', `(async () => {\n${PAGE}\nawait until(() => document.querySelector('section[aria-label="This page"]'), 'the task for the page')\nawait settle()\nreturn capture('browser')\n})()`)
    const html = `<div class="snapshot-browser"><div class="snapshot-webview">Web page: ${page}</div><div class="snapshot-sidebar">${sidebar.trim()}</div></div>`
    return write('browser.html', `<!-- commit ${commit}, captured ${captured} -->\n${html}\n`)
  } finally {
    await stop(EXTENSION_UI, session, child, join(ROOT, '.acorn/extension-dev', session))
  }
}

const asked = process.argv.slice(2).filter((arg) => arg !== '--')
const known = [...Object.keys(DESKTOP), ...Object.keys(TERMINAL), 'browser']
const unknown = asked.filter((scene) => !known.includes(scene))
if (unknown.length) {
  console.error(`Unknown scenes: ${unknown.join(', ')}. Known: ${known.join(', ')}.`)
  process.exit(1)
}
const pick = (scenes) => scenes.filter((scene) => asked.length === 0 || asked.includes(scene))
const desktop = pick(Object.keys(DESKTOP))
const terminal = pick(Object.keys(TERMINAL))
const browser = pick(['browser']).length > 0
const started = Date.now()
let problems = 0
const terminalSession = terminal.length || browser || desktop.includes('fleet') ? await startTerminal() : null
try {
  if (terminal.length) problems += await captureTerminal(terminal, terminalSession)
  if (desktop.length) problems += await captureDesktop(desktop, terminalSession)
  if (browser) problems += await captureBrowser(terminalSession)
} finally {
  await terminalSession?.stop()
}
const count = desktop.length + terminal.length + (browser ? 1 : 0)
console.log(`Captured ${count} scenes in ${Math.round((Date.now() - started) / 1000)} seconds.`)
if (problems) {
  console.error('Some snapshots carry real data. Fix the fixture, then capture again.')
  process.exitCode = 1
}
