import { isAbsolute, join } from 'node:path'
import { openDb } from '@acorn/node-core/server/bindings.ts'
import { createProject } from '@acorn/node-core/server/projects.ts'

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((pairs, value, index, all) => {
  if (index % 2 === 0) pairs.push([value, all[index + 1] ?? ''])
  return pairs
}, []))

const dataDir = args['--data-dir']
const projectPath = args['--project']
if (!dataDir || !projectPath || !isAbsolute(dataDir) || !isAbsolute(projectPath)) {
  throw new Error('Usage: seed.ts --data-dir ABSOLUTE_PATH --project ABSOLUTE_PATH')
}

const db = openDb(join(dataDir, 'core.sqlite'))
try {
  const result = await createProject(db, { path: projectPath })
  if (!result.ok) throw new Error(result.reason)
  process.stdout.write(`${result.project.id}\n`)
} finally {
  db.close()
}
