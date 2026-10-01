import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseTuiAgentOptions } from './agent-tui-options.mjs'
import { sessionDirectory } from '../apps/tui/scripts/agent/state.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

function run(args, capture = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(pnpm, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['inherit', capture ? 'pipe' : 'inherit', 'inherit'],
    })
    let output = ''
    if (capture) child.stdout.on('data', (chunk) => { output += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun(output)
      else reject(new Error(`pnpm ${args.join(' ')} exited with ${signal ?? code}.`))
    })
  })
}

async function seedSession(options, directory, dataDir) {
  if (options.onboarding) return null
  const fixturePath = join(directory, 'fixture.json')
  if (options.reuse && await exists(fixturePath)) {
    const previous = JSON.parse(await readFile(fixturePath, 'utf8'))
    const project = options.fixture ? join(directory, 'fixture', 'repo') : options.project ?? repoRoot
    if (previous.fixture !== options.fixture || previous.profile !== options.profile || previous.seed !== options.seed || previous.project !== project) {
      throw new Error('The saved fixture differs from these options. Choose a new session name.')
    }
    return previous
  }
  if (options.reuse && await exists(join(dataDir, 'core.sqlite'))) {
    throw new Error('This session has data but no fixture record. Choose a new session name.')
  }
  const project = options.fixture
    ? join(directory, 'fixture', 'repo')
    : options.project ?? repoRoot
  const args = ['--filter', '@acorn/desktop', 'exec', 'node', '--import', 'tsx', 'scripts/agent/seed.ts',
    '--data-dir', dataDir, '--project', project]
  if (options.fixture) args.push('--fixture', options.fixture, '--profile', options.profile, '--seed', String(options.seed))
  const output = await run(args, true)
  const result = options.fixture ? JSON.parse(output.trim().split('\n').at(-1)) : { projectId: output.trim().split('\n').at(-1) }
  const record = { fixture: options.fixture, profile: options.profile, seed: options.seed, project, ...result }
  await writeFile(fixturePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  await chmod(fixturePath, 0o600)
  return record
}

async function main() {
  const options = parseTuiAgentOptions(process.argv.slice(2))
  const directory = sessionDirectory(options.session)
  if (!options.reuse && await exists(directory)) throw new Error(`Session ${options.session} exists. Pass --reuse or choose another name.`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const dataDir = join(directory, 'data')
  const fixture = await seedSession(options, directory, dataDir)
  console.log(`[tui-agent:${options.session}] ${fixture ? `seeded ${fixture.fixture ?? fixture.project}` : 'empty profile'}`)
  await run(['--filter', '@acorn/tui', 'run', 'agent:session', '--',
    '--session', options.session, '--data-dir', dataDir,
    '--cols', String(options.cols), '--rows', String(options.rows), '--keyboard', options.keyboard,
    ...(options.reuse ? ['--reuse'] : []),
  ])
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
