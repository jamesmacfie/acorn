#!/usr/bin/env node
// Move the development data root into the installed desktop app's folders, so a release build opens the
// same Node: same identity, tasks, agent history, and paired devices. Run without --execute to inspect.
// docs/data-layer/data-root.md covers both roots.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Runtime files the Node recreates. Worktrees are moved, not copied, because git registers each one in one place.
const SKIP_ROOT = new Set(['node.lock', 'logs', 'worktrees'])
const SKIP_CUSTODY = new Set(['compile-cache'])

// How Claude Code names a project folder after its working directory.
export const claudeProjectName = path => path.replace(/[^a-zA-Z0-9]/g, '-')

function defaultPaths() {
  const app = join(homedir(), 'Library', 'Application Support', 'com.acorn.desktop')
  return {
    source: join(REPO, 'apps/node/.acorn'),
    sourceCustody: join(REPO, 'apps/node/.acorn-shell'),
    sourceEnv: join(REPO, 'apps/desktop/.env'),
    target: join(app, 'node'),
    targetCustody: app,
  }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

function keychainKeyExists() {
  return spawnSync('/usr/bin/security', ['find-generic-password', '-s', 'acorn', '-a', 'data-key'], { stdio: 'ignore' }).status === 0
}

/** Everything that would block the move. An empty list means it's safe to run. */
export function preflight(paths, { keychain = keychainKeyExists, replaceKeychainKey = false } = {}) {
  const problems = []
  if (!existsSync(join(paths.source, 'node.json'))) problems.push(`No development Node at ${paths.source}.`)
  if (!existsSync(join(paths.sourceCustody, 'data.key'))) problems.push(`No development data key at ${join(paths.sourceCustody, 'data.key')}.`)
  const lock = join(paths.source, 'node.lock')
  const pid = existsSync(lock) ? Number(readFileSync(lock, 'utf8').trim()) : 0
  if (pid && pidAlive(pid)) problems.push(`The development Node is running (process ${pid}). Stop it first.`)
  if (existsSync(paths.targetCustody)) problems.push(`${paths.targetCustody} already exists. Quit the installed app and move that folder aside first.`)
  // The installed app reads the keychain before data.key, so a leftover entry would hide the copied key.
  if (keychain() && !replaceKeychainKey) problems.push('The keychain has an old acorn data key, which the installed app would use instead of the copied one. Rerun with --replace-keychain-key to save and delete it.')
  return problems
}

/** The steps, in order, as plain descriptions. --execute runs them; without it they're only printed. */
function plan(paths, { replaceKeychainKey = false } = {}) {
  const from = join(paths.source, 'worktrees')
  const to = join(paths.target, 'worktrees')
  const steps = []
  if (replaceKeychainKey) steps.push({ kind: 'keychain', backup: join(paths.targetCustody, 'replaced-keychain-data.key') })
  for (const name of readdirSync(paths.sourceCustody)) if (!SKIP_CUSTODY.has(name)) steps.push({ kind: 'clone', from: join(paths.sourceCustody, name), to: join(paths.targetCustody, name) })
  for (const name of readdirSync(paths.source)) if (!SKIP_ROOT.has(name)) steps.push({ kind: 'clone', from: join(paths.source, name), to: join(paths.target, name) })
  if (existsSync(paths.sourceEnv)) steps.push({ kind: 'clone', from: paths.sourceEnv, to: join(paths.target, '.env') })
  if (existsSync(from)) {
    steps.push({ kind: 'move', from, to })
    for (const name of readdirSync(from)) if (existsSync(join(from, name, '.git'))) steps.push({ kind: 'repair', worktree: join(to, name) })
  }
  steps.push({ kind: 'tasks', from: `${from}/`, to: `${to}/` })
  steps.push({ kind: 'claude', from, to })
  return steps
}

// Rewrite the worktree paths that tasks point at. Agent history keeps the old paths, as a record.
function rewriteTaskPaths(database, from, to) {
  const db = new DatabaseSync(database)
  try {
    return db.prepare('UPDATE tasks SET worktree_path = ? || substr(worktree_path, ?) WHERE substr(worktree_path, 1, ?) = ?')
      .run(to, from.length + 1, from.length, from).changes
  } finally { db.close() }
}

// Claude keeps transcripts in a folder named after the working directory, so resume needs the folder to
// follow the worktree. shortcut: Claude accounts only, because they're the only kind in use; add Codex if it gains accounts.
function moveClaudeProjects(accountsRoot, from, to) {
  const claude = join(accountsRoot, 'claude')
  if (!existsSync(claude)) return 0
  const [oldName, newName] = [claudeProjectName(from), claudeProjectName(to)]
  let moved = 0
  for (const account of readdirSync(claude)) {
    const projects = join(claude, account, 'projects')
    for (const name of existsSync(projects) ? readdirSync(projects) : []) {
      if (!name.startsWith(`${oldName}-`)) continue
      renameSync(join(projects, name), join(projects, newName + name.slice(oldName.length)))
      moved++
    }
    const settings = join(claude, account, '.claude.json')
    if (existsSync(settings)) writeFileSync(settings, readFileSync(settings, 'utf8').replaceAll(`${from}/`, `${to}/`), { mode: 0o600 })
  }
  return moved
}

function run(step, paths) {
  switch (step.kind) {
    case 'keychain': {
      const old = spawnSync('/usr/bin/security', ['find-generic-password', '-s', 'acorn', '-a', 'data-key', '-w'], { encoding: 'utf8' })
      if (old.status !== 0) throw new Error('Could not read the old keychain data key, so it was left in place.')
      mkdirSync(paths.targetCustody, { recursive: true, mode: 0o700 })
      writeFileSync(step.backup, old.stdout.trim(), { mode: 0o600 })
      const removed = spawnSync('/usr/bin/security', ['delete-generic-password', '-s', 'acorn', '-a', 'data-key'], { stdio: 'ignore' })
      if (removed.status !== 0) throw new Error('Could not delete the old keychain data key.')
      return
    }
    case 'clone': {
      mkdirSync(dirname(step.to), { recursive: true, mode: 0o700 })
      // -c makes copy-on-write clones on APFS, so gigabytes copy instantly and the dev root stays as a rollback.
      const copy = spawnSync('/bin/cp', ['-Rpc', step.from, step.to], { encoding: 'utf8' })
      if (copy.status !== 0) throw new Error(`Copy of ${step.from} failed: ${copy.stderr.trim()}`)
      return
    }
    case 'move': return renameSync(step.from, step.to)
    case 'repair': {
      const repair = spawnSync('git', ['-C', step.worktree, 'worktree', 'repair'], { encoding: 'utf8' })
      if (repair.status !== 0) console.error(`git worktree repair failed in ${step.worktree}: ${repair.stderr.trim()}`)
      return
    }
    case 'tasks': return console.error(`${rewriteTaskPaths(join(paths.target, 'core.sqlite'), step.from, step.to)} task worktree path(s) rewritten.`)
    case 'claude': return console.error(`${moveClaudeProjects(join(paths.target, 'agent-accounts'), step.from, step.to)} Claude project folder(s) renamed.`)
  }
}

export function moveDevRoot(paths, { execute = false, replaceKeychainKey = false, keychain } = {}) {
  const problems = preflight(paths, { keychain, replaceKeychainKey })
  if (problems.length && execute) throw new Error(problems.join('\n'))
  const steps = plan(paths, { replaceKeychainKey })
  if (execute) {
    mkdirSync(paths.target, { recursive: true, mode: 0o700 })
    chmodSync(paths.targetCustody, 0o700)
    for (const step of steps) run(step, paths)
  }
  return { steps, problems }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2))
  try {
    if (process.platform !== 'darwin') throw new Error('This script moves a root into the macOS desktop app only.')
    const execute = args.has('--execute')
    const { steps, problems } = moveDevRoot(defaultPaths(), { execute, replaceKeychainKey: args.has('--replace-keychain-key') })
    for (const step of steps) console.log(JSON.stringify(step))
    for (const problem of problems) console.error(`Blocked: ${problem}`)
    console.error(execute
      ? 'Done. Start the installed app. The dev root is untouched apart from its worktrees, which moved; start a dev Node again only after pnpm db:reset.'
      : 'Nothing changed. Rerun with --execute to move.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
