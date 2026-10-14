import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const migrations = fileURLToPath(new URL('../../../migrations', import.meta.url))
const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[]
}

// One migration's statements, run the way the migrator splits them.
const apply = (db: DatabaseSync, tag: string) => {
  for (const statement of readFileSync(join(migrations, `${tag}.sql`), 'utf8').split('--> statement-breakpoint'))
    if (statement.trim()) db.exec(statement)
}

// A data root written before `normalizeGithubPart` can hold two `task_pulls` rows for one pull request
// whose owner and name differ only in case. They lowercase to one change request, so the copy must
// keep one row rather than abort the migration and the Node's boot with it.
it('copies case-variant task_pulls rows for one pull request as one primary', () => {
  const db = new DatabaseSync(':memory:')
  for (const { tag } of journal.entries.filter((entry) => entry.idx < 10)) apply(db, tag)
  db.exec(`
    INSERT INTO workspaces (id, name, is_default, sort, created_at, updated_at) VALUES ('w', 'W', 1, 0, 1, 1);
    INSERT INTO projects (id, name, workspace_id, sort, hidden, github_owner, github_name, repo_provider, repo_host, repo_path, created_at, updated_at)
      VALUES ('p', 'widget', 'w', 0, 0, 'Acme', 'Widget', 'github', 'github.com', 'acme/widget', 1, 1);
    INSERT INTO tasks (id, title, origin, project_id, branch, pull_number, status, sort, created_at, updated_at)
      VALUES ('t', 'Task', 'local', 'p', 'feat', 7, 'active', 0, 1, 1);
    INSERT INTO task_pulls (task_id, repo_owner, repo_name, pull_number, role, provenance, session_id, created_at)
      VALUES ('t', 'acme', 'widget', 7, 'related', 'agent', 'later', 2),
             ('t', 'Acme', 'Widget', 7, 'primary', 'agent', 'first', 3);
  `)

  apply(db, journal.entries.find((entry) => entry.idx === 10)!.tag)

  expect(db.prepare('SELECT * FROM task_change_requests').all()).toEqual([
    {
      task_id: 't',
      provider: 'github',
      repo_host: 'github.com',
      repo_path: 'acme/widget',
      number: 7,
      role: 'primary',
      provenance: 'agent',
      source_branch: null,
      session_id: 'first',
      request_id: null,
      created_at: 3,
    },
  ])
  db.close()
})
