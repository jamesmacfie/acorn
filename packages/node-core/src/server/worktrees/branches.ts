import { and, eq } from 'drizzle-orm'
import type { ProjectBranches } from '@acorn/protocol/api.ts'
import { schema, type AppDatabase } from '../db'
import type { ProjectRow } from '../projects'
import { gitText } from '../core/git'

export async function localBranches(checkout: string): Promise<Array<{ name: string; committedAt: number }>> {
  const refs = await gitText(['for-each-ref', '--sort=-committerdate', '--format=%(refname:strip=2)%00%(committerdate:unix)', 'refs/heads'], { cwd: checkout, timeoutMs: 10_000 })
  return refs ? refs.split('\n').map((ref) => {
    const [name, seconds] = ref.split('\0')
    return { name, committedAt: Number(seconds) * 1_000 }
  }) : []
}

export async function projectBranches(db: AppDatabase, project: ProjectRow): Promise<ProjectBranches> {
  if (project.vcs !== 'git' || !project.path) return { current: null, tasks: [], other: [] }
  const branches = await localBranches(project.path)
  const names = new Set(branches.map((branch) => branch.name))
  const tasks = db.select({ branch: schema.tasks.branch, taskId: schema.tasks.id, title: schema.tasks.title })
    .from(schema.tasks).where(and(eq(schema.tasks.projectId, project.id), eq(schema.tasks.status, 'active'))).all()
    .flatMap((task) => task.branch && names.has(task.branch) ? [{ ...task, branch: task.branch }] : [])
  const used = new Set(tasks.map((task) => task.branch))
  const current = await gitText(['branch', '--show-current'], { cwd: project.path, timeoutMs: 10_000 })
  return { current: current || null, tasks, other: branches.filter((branch) => !used.has(branch.name)) }
}
