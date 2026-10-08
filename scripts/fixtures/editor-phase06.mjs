import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'

const root = process.argv[2]
if (!root) throw new Error('Pass a disposable fixture repository path')
const repo = resolve(root)
if (!repo.includes(`${sep}.acorn${sep}agent-dev${sep}`) || basename(repo) !== 'repo' || !existsSync(join(repo, '.git')))
  throw new Error('Use a seeded .acorn/agent-dev/<session>/fixture/repo Git repository')

writeFileSync(join(repo, '.gitignore'), 'build/\n**/generated/\n')
for (let i = 0; i < 100; i += 1) {
  const folder = join(repo, 'src', `group-${String(i).padStart(3, '0')}`)
  mkdirSync(folder, { recursive: true })
  for (let j = 0; j < 100; j += 1) {
    writeFileSync(join(folder, `item-${String(j).padStart(3, '0')}.tsx`),
      `export const item${j} = 'needle group ${i}';\n`)
  }
}

mkdirSync(join(repo, 'src', 'group-000', 'generated'), { recursive: true })
writeFileSync(join(repo, 'src', 'group-000', 'generated', 'item.tsx'), 'needle generated\n')
mkdirSync(join(repo, 'build'), { recursive: true })
writeFileSync(join(repo, 'build', 'output.tsx'), 'needle ignored\n')
writeFileSync(join(repo, 'src', 'large.txt'), 'needle large\n'.repeat(100_000))
writeFileSync(join(repo, 'assets', 'large-image.bin'), Buffer.alloc(1024 * 1024, 0x89))
