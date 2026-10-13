import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { max } from 'drizzle-orm'
import { WORKSPACES_PREF_KEY } from '@acorn/protocol/workspacesMode.ts'
import { TELEMETRY_PREF_KEY } from '@acorn/protocol/telemetry.ts'
import {
  largeDiffFiles,
  largeDiffSummary,
  type LargeDiffFile,
  type LargeSurfaceProfile,
} from '@acorn/client-core/testkit/large-diff'
import { activeIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { openDb } from '@acorn/node-core/server/bindings.ts'
import { writePreference } from '@acorn/node-core/server/core/prefs.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { createProject } from '@acorn/node-core/server/projects.ts'
import { openDataRoot } from '@acorn/node-core/server/storage'
import { makeTestNodeContext } from '@acorn/node-core/testkit'
import {
  seedCommandRestart,
  seedDelegationCheckReport,
  seedLargeSession,
  seedUnattendedPolicy,
} from '@acorn/plugin-agents/testkit'
import { seedReviewNotes } from '@acorn/plugin-git/testkit'

// Seeds an agent-automation data root before the window starts (docs/local-development/agent-drivers.md
// § Drive the desktop). Without a fixture it adds one project. Fixtures put a generated Git
// repository, task, review notes and agent session into an isolated root. `tui-navigation` also
// adds a second task and a second workspace/project so both UI hosts can exercise navigation over
// the same scenario (docs/testing/desktop.md § The large-surface fixture). Prints one JSON line the launcher records.

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((pairs, value, index, all) => {
    if (index % 2 === 0) pairs.push([value, all[index + 1] ?? ''])
    return pairs
  }, []),
)

const dataDir = args['--data-dir']
const projectPath = args['--project']
const fixture = args['--fixture']
const workspaces = args['--workspaces']
const telemetry = args['--telemetry']
const profile = (args['--profile'] || 'small') as LargeSurfaceProfile
const seed = Number(args['--seed'] || 1)
if (!dataDir || !projectPath || !isAbsolute(dataDir) || !isAbsolute(projectPath)) {
  throw new Error(
    'Usage: seed.ts --data-dir ABSOLUTE_PATH --project ABSOLUTE_PATH [--fixture large-surfaces|tui-navigation|delegation-checks|unattended-policy|streaming-replay --profile small|scale|canonical --seed N]',
  )
}
if (
  fixture &&
  ![
    'large-surfaces',
    'tui-navigation',
    'delegation-checks',
    'unattended-policy',
    'command-restart',
    'streaming-replay',
  ].includes(fixture)
)
  throw new Error(`Unknown fixture: ${fixture}`)
if (workspaces !== undefined && workspaces !== 'on' && workspaces !== 'off')
  throw new Error('--workspaces must be on or off.')
if (telemetry !== undefined && !['on', 'off'].includes(telemetry)) throw new Error('--telemetry must be on or off.')
if (!['small', 'scale', 'canonical'].includes(profile) || !Number.isInteger(seed))
  throw new Error('Profile must be small, scale or canonical, and seed an integer.')

const git = (cwd: string, ...command: string[]) =>
  execFileSync('git', command, {
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
  git(
    root,
    '-c',
    'user.name=Acorn fixture',
    '-c',
    'user.email=fixture@acorn.invalid',
    'commit',
    '-q',
    '-m',
    'Fixture base',
  )
  const apply = (file: LargeDiffFile) => {
    if (file.oldPath) rmSync(join(root, file.oldPath), { force: true })
    if (file.head == null) rmSync(join(root, file.path), { force: true })
    else write(root, file.path, file.head, file.binary)
  }
  for (const file of largeDiffFiles(profile, seed)) apply(file)
}

const root = openDataRoot(dataDir)
try {
  if (fixture === 'streaming-replay') {
    mkdirSync(projectPath, { recursive: true })
    writeFileSync(join(projectPath, 'README.md'), '# Generated streaming replay project\n')
  } else if (fixture) writeRepository(projectPath)
  const db = openDb(join(dataDir, 'core.sqlite'))
  try {
    const ownerId = activeIdentityStore(dataDir).get() ?? ''
    if (workspaces) writePreference(db, ownerId, WORKSPACES_PREF_KEY, workspaces)
    if (telemetry) writePreference(db, ownerId, TELEMETRY_PREF_KEY, telemetry === 'on' ? '1' : '0')
    const result = await createProject(db, { path: projectPath }, ownerId)
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
        id: taskId,
        title:
          fixture === 'command-restart'
            ? 'Command restart verification'
            : fixture === 'tui-navigation'
              ? 'Review changed files'
              : fixture === 'delegation-checks'
                ? 'Delegation check report'
                : fixture === 'streaming-replay'
                  ? 'Streaming replay'
                  : fixture === 'unattended-policy'
                    ? 'Unattended request policy'
                    : `Large surfaces (${profile})`,
        icon: null,
        origin: 'local',
        projectId: result.project.id,
        branch: null,
        skipSetup: true,
        pullNumber: null,
        worktreePath: null,
        status: 'active',
        parentId: null,
        sort: (value ?? -1) + 1,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      })

      let otherTaskId: string | undefined
      let otherWorkspaceTaskId: string | undefined
      if (fixture === 'tui-navigation') {
        otherTaskId = randomUUID()
        await db.insert(schema.tasks).values({
          id: otherTaskId,
          title: 'Plan follow-up work',
          icon: null,
          origin: 'local',
          projectId: result.project.id,
          branch: null,
          skipSetup: true,
          pullNumber: null,
          worktreePath: null,
          status: 'active',
          parentId: null,
          sort: (value ?? -1) + 2,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        })

        // This project belongs to a separate workspace. The folder stays beside the generated repo,
        // inside the fixture directory, so a session never adds or changes a personal checkout.
        let otherWorkspaceId: string | undefined
        if (workspaces === 'on') {
          otherWorkspaceId = randomUUID()
          await db.insert(schema.workspaces).values({
            id: otherWorkspaceId,
            name: 'Side project',
            isDefault: false,
            sort: 1,
            createdAt: now,
            updatedAt: now,
          })
        }
        const otherPath = join(dirname(projectPath), 'side-project')
        mkdirSync(otherPath, { recursive: true })
        writeFileSync(join(otherPath, 'README.md'), '# Side project\n')
        const otherProject = await createProject(
          db,
          { path: otherPath, ...(otherWorkspaceId ? { workspaceId: otherWorkspaceId } : {}) },
          ownerId,
        )
        if (!otherProject.ok) throw new Error(otherProject.reason)
        otherWorkspaceTaskId = randomUUID()
        await db.insert(schema.tasks).values({
          id: otherWorkspaceTaskId,
          title: 'Check workspace switch',
          icon: null,
          origin: 'local',
          projectId: otherProject.project.id,
          branch: null,
          skipSetup: true,
          pullNumber: null,
          worktreePath: null,
          status: 'active',
          parentId: null,
          sort: (value ?? -1) + 3,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        })
      }

      let session: Awaited<ReturnType<typeof seedLargeSession>> | undefined
      if (fixture !== 'streaming-replay') {
        const notes = [...largeDiffFiles(profile, seed)].flatMap((file) => file.notes)
        const git = makeTestNodeContext({ plugin: { name: 'git' }, dataDir })
        try {
          await seedReviewNotes(git.storage.open(), taskId, notes)
        } finally {
          git.cleanup()
        }

        const agents = makeTestNodeContext({ plugin: { name: 'agents' }, dataDir })
        try {
          if (fixture === 'command-restart') {
            session = await seedCommandRestart(agents.storage.open(), agents.core, taskId)
          } else if (fixture === 'unattended-policy') {
            session = await seedUnattendedPolicy({
              db: agents.storage.open(),
              core: agents.core,
              secrets: agents.env.SECRETS,
              dataDir,
              taskId,
              taskRoot: projectPath,
            })
          } else if (fixture === 'delegation-checks') {
            session = await seedDelegationCheckReport(agents.storage.open(), agents.core, taskId)
          } else {
            // A short second session for the session-revisit flow to step away to. Written first, so the
            // long one changed last and still opens by default.
            if (fixture === 'large-surfaces') {
              await seedLargeSession(agents.storage.open(), agents.core, {
                taskId,
                profile: 'small',
                seed,
                title: 'Small session',
              })
            }
            session = await seedLargeSession(agents.storage.open(), agents.core, { taskId, profile, seed })
          }
        } finally {
          agents.cleanup()
        }
      }

      const summary = fixture === 'streaming-replay' ? null : largeDiffSummary(profile, seed)
      process.stdout.write(
        `${JSON.stringify({
          fixture,
          profile,
          seed,
          ...(telemetry ? { telemetry } : {}),
          projectId: result.project.id,
          taskId,
          sessionId: session?.session.id,
          ...(otherTaskId ? { otherTaskId, otherWorkspaceTaskId } : {}),
          files: summary?.files ?? 0,
          fixedRows: summary?.fixedRows ?? 0,
          threads: summary?.threads ?? 0,
          notes: summary?.notes ?? 0,
          digest: summary?.digest ?? '',
          turns: session?.turns ?? 0,
          events: session?.events ?? 0,
        })}\n`,
      )
    }
  } finally {
    db.close()
  }
} finally {
  root.release()
}
