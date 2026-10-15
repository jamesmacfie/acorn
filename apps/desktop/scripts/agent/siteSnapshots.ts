import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, max, sql } from 'drizzle-orm'
import { WORKSPACES_PREF_KEY } from '@acorn/protocol/workspacesMode.ts'
import { writePreference } from '@acorn/node-core/server/core/prefs.ts'
import { schema, type AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { createProject } from '@acorn/node-core/server/projects.ts'
import { makeTestNodeContext } from '@acorn/node-core/testkit'
import { seedTranscript } from '@acorn/plugin-agents/testkit'
import { NotesStore } from '@acorn/plugin-notes/testkit'
import { createPublishedDef } from '@acorn/plugin-workflows/testkit'

// The world every shell snapshot on the site draws (docs/site/snapshots.md § The fixture): one invented
// workspace, its projects as real Git repositories, tasks, notes, and an agent session. It lives with
// the site in apps/site/snapshots/fixture/ and is read here by path, the way the terminal client reads
// the site's specimens, so the two apps never import each other.

const FIXTURE = fileURLToPath(new URL('../../../site/snapshots/fixture/', import.meta.url))

type Note = { title: string; kind: 'scratch' | 'finding'; body: string }
type World = {
  workspace: string
  projects: { name: string; folder: string; remote: string }[]
  author: { name: string; email: string }
  tasks: { key: string; title: string; project: string; pullNumber?: number; notes?: Note[]; sql?: string }[]
  pull: { branch: string; title: string }
  workflow: Parameters<typeof createPublishedDef>[1]['def']
  workspaceNotes: Note[]
  session: {
    task: string
    title: string
    model: string
    turns: { user: string; events: ({ type: string } & Record<string, unknown>)[] }[]
  }
}

/** Every commit carries this date, so a recapture shows the same history. */
const COMMITTED = '2026-10-12T09:30:00Z'

/** A project's repository: `base/` committed and `head/` laid over it as uncommitted changes, or the
 *  whole folder committed when it has no `base/`. A `pull/` folder is committed on the pull request's
 *  branch, so its diff is a real one. */
function writeRepository(world: World, folder: string, remote: string, path: string): void {
  const git = (...command: string[]) =>
    execFileSync('git', command, {
      cwd: path,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: world.author.name,
        GIT_AUTHOR_EMAIL: world.author.email,
        GIT_AUTHOR_DATE: COMMITTED,
        GIT_COMMITTER_NAME: world.author.name,
        GIT_COMMITTER_EMAIL: world.author.email,
        GIT_COMMITTER_DATE: COMMITTED,
      },
    })
  const source = join(FIXTURE, folder)
  const layered = existsSync(join(source, 'base'))
  rmSync(path, { recursive: true, force: true })
  mkdirSync(path, { recursive: true })
  git('init', '-q', '-b', 'main')
  cpSync(layered ? join(source, 'base') : source, path, { recursive: true })
  git('add', '-A')
  git('commit', '-q', '-m', 'Initial import')
  git('remote', 'add', 'origin', remote)
  if (existsSync(join(source, 'pull'))) {
    git('checkout', '-q', '-b', world.pull.branch)
    cpSync(join(source, 'pull'), path, { recursive: true })
    git('add', '-A')
    git('commit', '-q', '-m', world.pull.title)
    git('checkout', '-q', 'main')
  }
  if (layered) cpSync(join(source, 'head'), path, { recursive: true })
}

/** A change event's patch, from its first hunk, read from the repository so the transcript and the
 *  Changes pane agree. `--no-index` against nothing covers a new file, and exits 1 on any difference. */
function patchOf(path: string, file: string): string {
  const tracked = execFileSync('git', ['diff', '--no-color', '--', file], { cwd: path, encoding: 'utf8' })
  const diff =
    tracked ||
    spawnSync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', file], { cwd: path, encoding: 'utf8' })
      .stdout
  return diff.slice(diff.indexOf('@@'))
}

export async function seedSiteSnapshots(
  db: AppDatabase,
  ownerId: string,
  dataDir: string,
  projectPath: string,
): Promise<Record<string, unknown>> {
  const world = JSON.parse(readFileSync(join(FIXTURE, 'world.json'), 'utf8')) as World
  writePreference(db, ownerId, WORKSPACES_PREF_KEY, 'on')

  // The first project takes the launcher's project folder, and the rest sit beside it.
  const projects = new Map<string, { id: string; workspaceId: string; path: string }>()
  for (const [index, project] of world.projects.entries()) {
    const path = index === 0 ? projectPath : join(dirname(projectPath), project.folder)
    writeRepository(world, project.folder, project.remote, path)
    const created = await createProject(db, { path, name: project.name }, ownerId)
    if (!created.ok) throw new Error(created.reason)
    projects.set(project.name, { ...created.project, path })
  }
  const workspaceId = [...projects.values()][0]!.workspaceId
  await db.update(schema.workspaces).set({ name: world.workspace }).where(eq(schema.workspaces.id, workspaceId))

  // Core's tables are seeded directly, as the testkit allows for fixtures. A task with no branch runs
  // in its project folder, which is what the new-task dialog's "use the project folder" makes.
  const tasks = new Map<string, string>()
  const now = Date.now()
  const [{ value: lastSort }] = await db.select({ value: max(schema.tasks.sort) }).from(schema.tasks)
  for (const [index, task] of world.tasks.entries()) {
    const id = randomUUID()
    await db.insert(schema.tasks).values({
      id,
      title: task.title,
      icon: null,
      origin: 'local',
      projectId: projects.get(task.project)!.id,
      branch: null,
      skipSetup: true,
      pullNumber: task.pullNumber ?? null,
      worktreePath: null,
      status: 'active',
      parentId: null,
      sort: (lastSort ?? -1) + 1 + index,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
    tasks.set(task.key, id)
  }

  const notes = new NotesStore(join(dataDir, 'notes'))
  for (const note of world.workspaceNotes) {
    await notes.create({ scope: 'workspace', workspaceId }, note.title, { kind: note.kind, body: note.body })
  }
  for (const task of world.tasks) {
    for (const note of task.notes ?? []) {
      await notes.create({ scope: 'task', taskId: tasks.get(task.key)! }, note.title, {
        kind: note.kind,
        body: note.body,
      })
    }
  }

  // A task's Database pane opens on the query in its scratch document.
  const database = makeTestNodeContext({ plugin: { name: 'database' }, dataDir })
  try {
    for (const task of world.tasks.filter((task) => task.sql)) {
      const query = readFileSync(join(FIXTURE, task.sql!), 'utf8')
      database.storage
        .open()
        .run(sql`insert into db_scratch (task_id, sql, updated_at) values (${tasks.get(task.key)}, ${query}, ${now})`)
    }
  } finally {
    database.cleanup()
  }

  // A published workflow, ready to start from a task.
  const workflows = makeTestNodeContext({ plugin: { name: 'workflows' }, dataDir })
  let workflowId: string
  try {
    const projectId = projects.get(world.projects[0]!.name)!.id
    workflowId = (await createPublishedDef(workflows.storage.open(), { workspaceId, projectId, def: world.workflow }))
      .id
  } finally {
    workflows.cleanup()
  }

  const { session: transcript } = world
  const taskId = tasks.get(transcript.task)!
  const taskPath = projects.get(world.tasks.find((task) => task.key === transcript.task)!.project)!.path
  const agents = makeTestNodeContext({ plugin: { name: 'agents' }, dataDir })
  let sessionId: string
  try {
    const seeded = await seedTranscript(agents.storage.open(), agents.core, {
      taskId,
      title: transcript.title,
      kind: 'interactive',
      config: {
        configOptions: [
          {
            id: 'model',
            label: 'Model',
            category: 'model',
            currentValue: 'fixture',
            values: [{ value: 'fixture', label: transcript.model }],
          },
        ],
      },
      turns: transcript.turns.map((turn) => ({
        user: turn.user,
        events: [
          { type: 'user_message', text: turn.user },
          ...turn.events.map((event) =>
            event.type === 'file_change' ? { ...event, patch: patchOf(taskPath, event.path as string) } : event,
          ),
        ] as Parameters<typeof seedTranscript>[2]['turns'][number]['events'],
      })),
      detail: 'Site snapshot fixture.',
    })
    sessionId = seeded.session.id
  } finally {
    agents.cleanup()
  }

  return {
    projectId: projects.get(world.projects[0]!.name)!.id,
    taskId,
    sessionId,
    workflowId,
    tasks: Object.fromEntries(tasks),
  }
}
