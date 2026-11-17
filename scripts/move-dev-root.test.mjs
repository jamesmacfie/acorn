import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, test } from 'node:test'
import { claudeProjectName, moveDevRoot, preflight } from './move-dev-root.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const git = (cwd, ...args) => {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

// A dev root with one task worktree, a Claude transcript for it, and a desktop custody folder.
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'acorn-move-')))
  roots.push(base)
  const paths = {
    source: join(base, 'dev/.acorn'),
    sourceCustody: join(base, 'dev/.acorn-shell'),
    sourceEnv: join(base, 'dev/.env'),
    target: join(base, 'App Support/com.acorn.desktop/node'),
    targetCustody: join(base, 'App Support/com.acorn.desktop'),
  }
  const repo = join(base, 'repo')
  const worktree = join(paths.source, 'worktrees/owner-repo-branch')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'root')
  git(repo, 'worktree', 'add', '-q', '-b', 'branch', worktree)
  mkdirSync(paths.sourceCustody, { recursive: true })
  writeFileSync(join(paths.sourceCustody, 'data.key'), 'a'.repeat(64))
  writeFileSync(join(paths.source, 'node.json'), '{"nodeId":"same"}')
  writeFileSync(join(paths.source, 'node.lock'), '999999999')
  writeFileSync(paths.sourceEnv, 'SECRET=1\n')
  const db = new DatabaseSync(join(paths.source, 'core.sqlite'))
  db.exec('CREATE TABLE tasks (id TEXT, worktree_path TEXT)')
  db.prepare('INSERT INTO tasks VALUES (?, ?), (?, ?), (?, NULL)').run('moved', worktree, 'elsewhere', repo, 'none')
  db.close()
  const account = join(paths.source, 'agent-accounts/claude/personal')
  mkdirSync(join(account, 'projects', claudeProjectName(worktree)), { recursive: true })
  mkdirSync(join(account, 'projects', claudeProjectName(repo)), { recursive: true })
  writeFileSync(join(account, '.claude.json'), JSON.stringify({ projects: { [worktree]: {}, [repo]: {} } }))
  return { paths, repo, worktree }
}

test('refuses while the dev Node runs, when the app folder exists, or when a keychain key would win', () => {
  const { paths } = fixture()
  assert.deepEqual(preflight(paths, { keychain: () => false }), [])
  writeFileSync(join(paths.source, 'node.lock'), String(process.pid))
  mkdirSync(paths.targetCustody, { recursive: true })
  const problems = preflight(paths, { keychain: () => true }).join('\n')
  assert.match(problems, /is running/)
  assert.match(problems, /already exists/)
  assert.match(problems, /--replace-keychain-key/)
})

test('a dry run changes nothing', () => {
  const { paths, worktree } = fixture()
  writeFileSync(join(paths.source, 'node.lock'), String(process.pid))
  const { steps, problems } = moveDevRoot(paths, { keychain: () => false })
  assert.match(problems.join(), /is running/)
  assert.throws(() => moveDevRoot(paths, { execute: true, keychain: () => false }), /is running/)
  assert.ok(steps.some(step => step.kind === 'move'))
  assert.equal(existsSync(paths.targetCustody), false)
  assert.equal(existsSync(worktree), true)
})

test('moves the root so tasks, git, and Claude transcripts follow the worktree', () => {
  const { paths, repo, worktree } = fixture()
  moveDevRoot(paths, { execute: true, keychain: () => false })
  const moved = join(paths.target, 'worktrees/owner-repo-branch')

  assert.equal(readFileSync(join(paths.targetCustody, 'data.key'), 'utf8'), 'a'.repeat(64))
  assert.equal(readFileSync(join(paths.target, 'node.json'), 'utf8'), '{"nodeId":"same"}')
  assert.equal(readFileSync(join(paths.target, '.env'), 'utf8'), 'SECRET=1\n')
  assert.equal(existsSync(join(paths.target, 'node.lock')), false)
  assert.equal(existsSync(join(paths.source, 'core.sqlite')), true, 'the dev root stays as a rollback')

  const db = new DatabaseSync(join(paths.target, 'core.sqlite'))
  assert.deepEqual(db.prepare('SELECT id, worktree_path AS path FROM tasks ORDER BY id').all().map(row => ({ ...row })), [
    { id: 'elsewhere', path: repo },
    { id: 'moved', path: moved },
    { id: 'none', path: null },
  ])
  db.close()

  assert.equal(existsSync(worktree), false)
  assert.equal(realpathSync(git(moved, 'rev-parse', '--show-toplevel')), moved)
  assert.match(git(repo, 'worktree', 'list'), new RegExp(moved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const account = join(paths.target, 'agent-accounts/claude/personal')
  assert.equal(existsSync(join(account, 'projects', claudeProjectName(moved))), true)
  assert.equal(existsSync(join(account, 'projects', claudeProjectName(repo))), true)
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(account, '.claude.json'), 'utf8')).projects), [moved, repo])
})
