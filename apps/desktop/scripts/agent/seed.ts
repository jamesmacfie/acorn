import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { max } from 'drizzle-orm'
import { largeDiffFiles, largeDiffSummary, type LargeDiffFile, type LargeSurfaceProfile } from '@acorn/client-core/testkit/large-diff'
import { openDb } from '@acorn/node-core/server/bindings.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { createProject } from '@acorn/node-core/server/projects.ts'
import { openDataRoot } from '@acorn/node-core/server/storage'
import { makeTestNodeContext } from '@acorn/node-core/testkit'
import { seedLargeSession } from '@acorn/plugin-agents/testkit'
import { seedReviewNotes } from '@acorn/plugin-changes/testkit'

// Seeds an agent-automation data root before the window starts (docs/local-development/agent-drivers.md
// § Drive the desktop). Without a fixture it adds one project. Fixtures put a generated Git
// repository, task, review notes and agent session into an isolated root. `tui-navigation` also
// adds a second task and a second workspace/project so both UI hosts can exercise navigation over
// the same scenario (docs/testing/desktop.md § The large-surface fixture). Prints one JSON line the launcher records.

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((pairs, value, index, all) => {
  if (index % 2 === 0) pairs.push([value, all[index + 1] ?? ''])
  return pairs
}, []))

const dataDir = args['--data-dir']
const projectPath = args['--project']
const fixture = args['--fixture']
const profile = (args['--profile'] || 'small') as LargeSurfaceProfile
const seed = Number(args['--seed'] || 1)
if (!dataDir || !projectPath || !isAbsolute(dataDir) || !isAbsolute(projectPath)) {
  throw new Error('Usage: seed.ts --data-dir ABSOLUTE_PATH --project ABSOLUTE_PATH [--fixture large-surfaces|tui-navigation --profile small|scale|canonical --seed N]')
}
if (fixture && fixture !== 'large-surfaces' && fixture !== 'tui-navigation') throw new Error(`Unknown fixture: ${fixture}`)
if (!['small', 'scale', 'canonical'].includes(profile) || !Number.isInteger(seed)) throw new Error('Profile must be small, scale or canonical, and seed an integer.')

const git = (cwd: string, ...command: string[]) => execFileSync('git', command, {
  cwd,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: {
    ...process.env,
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
  },
})

const write = (root: string, path: string, text: string, binary: boolean) => {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, binary ? Buffer.from(text, 'latin1') : text)
}

/** Both sides of every generated file: the base committed, the head left in the working tree. */
function writeRepository(root: string): void {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  git(root, 'init', '-q', '-b', 'main')
  for (const file of largeDiffFiles(profile, seed)) {
    if (file.base != null) write(root, file.oldPath ?? file.path, file.base, file.binary)
  }
  writeFileSync(join(root, 'README.md'), `Generated UI fixture: profile ${profile}, seed ${seed}.\n`)
  git(root, 'add', '-A')
  git(root, '-c', 'user.name=Acorn fixture', '-c', 'user.email=fixture@acorn.invalid', 'commit', '-q', '-m', 'Fixture base')
  const apply = (file: LargeDiffFile) => {
    if (file.oldPath) rmSync(join(root, file.oldPath), { force: true })
    if (file.head == null) rmSync(join(root, file.path), { force: true })
    else write(root, file.path, file.head, file.binary)
  }
  for (const file of largeDiffFiles(profile, seed)) apply(file)
}

const root = openDataRoot(dataDir)
try {
  if (fixture) writeRepository(projectPath)
  const db = openDb(join(dataDir, 'core.sqlite'))
  try {
    const result = await createProject(db, { path: projectPath })
    if (!result.ok) throw new Error(result.reason)
    if (!fixture) {
      process.stdout.write(`${result.project.id}\n`)
    } else {
      // A task with no branch runs in the project folder, which is what the new-task dialog's "use the
      // project folder" makes (node-core routes/projects/tasks.ts § POST). Core's tables are seeded
      // directly, as the testkit allows for fixtures.
      const taskId = randomUUID()
      const now = Date.now()
      const [{ value }] = await db.select({ value: max(schema.tasks.sort) }).from(schema.tasks)
      await db.insert(schema.tasks).values({
        id: taskId, title: fixture === 'tui-navigation' ? 'Review changed files' : `Large surfaces (${profile})`,
        icon: null, origin: 'local', projectId: result.project.id,
        branch: null, skipSetup: true, pullNumber: null, worktreePath: null, status: 'active', parentId: null,
        sort: (value ?? -1) + 1, createdAt: now, updatedAt: now, archivedAt: null,
      })

      let otherTaskId: string | undefined
      let otherWorkspaceTaskId: string | undefined
      if (fixture === 'tui-navigation') {
        otherTaskId = randomUUID()
        await db.insert(schema.tasks).values({
          id: otherTaskId, title: 'Plan follow-up work', icon: null, origin: 'local', projectId: result.project.id,
          branch: null, skipSetup: true, pullNumber: null, worktreePath: null, status: 'active', parentId: null,
          sort: (value ?? -1) + 2, createdAt: now, updatedAt: now, archivedAt: null,
        })

        // This project belongs to a separate workspace. The folder stays beside the generated repo,
        // inside the fixture directory, so a session never adds or changes a personal checkout.
        const otherWorkspaceId = randomUUID()
        await db.insert(schema.workspaces).values({
          id: otherWorkspaceId, name: 'Side project', isDefault: false, sort: 1,
          createdAt: now, updatedAt: now,
        })
        const otherPath = join(dirname(projectPath), 'side-project')
        mkdirSync(otherPath, { recursive: true })
        writeFileSync(join(otherPath, 'README.md'), '# Side project\n')
        const otherProject = await createProject(db, { path: otherPath, workspaceId: otherWorkspaceId })
        if (!otherProject.ok) throw new Error(otherProject.reason)
        otherWorkspaceTaskId = randomUUID()
        await db.insert(schema.tasks).values({
          id: otherWorkspaceTaskId, title: 'Check workspace switch', icon: null, origin: 'local',
          projectId: otherProject.project.id, branch: null, skipSetup: true, pullNumber: null,
          worktreePath: null, status: 'active', parentId: null, sort: (value ?? -1) + 3,
          createdAt: now, updatedAt: now, archivedAt: null,
        })
      }

      const notes = [...largeDiffFiles(profile, seed)].flatMap((file) => file.notes)
      const changes = makeTestNodeContext({ plugin: { name: 'changes' }, dataDir })
      try {
        await seedReviewNotes(changes.storage.open(), taskId, notes)
      } finally {
        changes.cleanup()
      }

      const agents = makeTestNodeContext({ plugin: { name: 'agents' }, dataDir })
      let session: Awaited<ReturnType<typeof seedLargeSession>>
      try {
        session = await seedLargeSession(agents.storage.open(), agents.core, { taskId, profile, seed })
      } finally {
        agents.cleanup()
      }

      const summary = largeDiffSummary(profile, seed)
      process.stdout.write(`${JSON.stringify({
        fixture, profile, seed,
        projectId: result.project.id, taskId, sessionId: session.session.id,
        ...(otherTaskId ? { otherTaskId, otherWorkspaceTaskId } : {}),
        files: summary.files, fixedRows: summary.fixedRows, threads: summary.threads, notes: summary.notes,
        digest: summary.digest, turns: session.turns, events: session.events,
      })}\n`)
    }
  } finally {
    db.close()
  }
} finally {
  root.release()
}
