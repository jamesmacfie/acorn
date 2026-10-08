import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'

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
writeFileSync(join(repo, 'src', 'large.txt'), 'needle large\n'.repeat(2_000_000))

// A valid 1024×1024, 24-bit BMP. Its uncompressed pixels make it a real large image read.
const width = 1024
const height = 1024
const pixels = width * height * 3
const image = Buffer.alloc(54 + pixels, 0x89)
image.fill(0, 0, 54)
image.write('BM')
image.writeUInt32LE(image.length, 2)
image.writeUInt32LE(54, 10)
image.writeUInt32LE(40, 14)
image.writeInt32LE(width, 18)
image.writeInt32LE(height, 22)
image.writeUInt16LE(1, 26)
image.writeUInt16LE(24, 28)
image.writeUInt32LE(pixels, 34)
writeFileSync(join(repo, 'assets', 'large-image.bmp'), image)

// The seed supplies unstaged edits. Add one staged edit and one three-stage index conflict.
execFileSync('git', ['add', '--', 'src/pkg-00/module-0000.ts'], { cwd: repo })
const blob = (text) => execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: text, encoding: 'utf8' }).trim()
const conflict = 'src/conflict.txt'
const stages = [blob('base\n'), blob('ours\n'), blob('theirs\n')]
const index = stages.map((hash, at) => `100644 ${hash} ${at + 1}\t${conflict}\n`).join('')
execFileSync('git', ['update-index', '--index-info'], { cwd: repo, input: index })
writeFileSync(join(repo, conflict), '<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n')
