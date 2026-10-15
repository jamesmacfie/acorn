// Rewrites src/data/github.json, the copy of GitHub's answer a build uses when GitHub doesn't answer.
// Run it now and then: `pnpm --filter @acorn/site github:refresh`.
import { writeFileSync } from 'node:fs'
import { fetchGithub } from '../src/lib/github.ts'

const file = new URL('../src/data/github.json', import.meta.url)
writeFileSync(file, `${JSON.stringify(await fetchGithub(), null, 2)}\n`)
console.log(`Wrote ${file.pathname}`)
