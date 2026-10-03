import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pnpmInvocation } from './run-pnpm.mjs'

const [pkg, ...selection] = process.argv.slice(2)
if (!pkg || selection.length === 0 || selection.every((arg) => arg.startsWith('-'))) {
  console.error('Usage: pnpm test:focus <package> <file-filter> [-t <test-name>]')
  process.exit(2)
}

const run = (args, options = {}) => {
  const [command, commandArgs] = pnpmInvocation(args)
  return spawnSync(command, commandArgs, options)
}

const listed = run(['--filter', pkg, 'list', '--depth', '-1', '--json'], { encoding: 'utf8' })
if (listed.error || listed.status !== 0) {
  console.error(listed.stderr || listed.error || `Could not resolve package '${pkg}'.`)
  process.exit(listed.status ?? 1)
}
let packages
try {
  packages = JSON.parse(listed.stdout)
} catch {
  console.error(`Could not read pnpm's package list for '${pkg}'.`)
  process.exit(1)
}
if (packages.length !== 1 || packages[0].name !== pkg) {
  console.error(`Expected one exact workspace package named '${pkg}'; matched ${packages.length}.`)
  process.exit(2)
}

const prepared = run(['rebuild:node'], { stdio: 'inherit' })
if (prepared.status !== 0) process.exit(prepared.status ?? 1)

const outputDir = mkdtempSync(join(tmpdir(), 'acorn-test-focus-'))
const report = join(outputDir, 'vitest.json')
let exitCode = 0
try {
  const result = run([
    '--filter', pkg, 'exec', 'vitest', 'run', ...selection,
    '--passWithNoTests=false', '--reporter=default', '--reporter=json', `--outputFile=${report}`,
  ], { stdio: 'inherit', env: { ...process.env, VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS || '3' } })
  exitCode = result.status ?? 1
  if (exitCode === 0) {
    let summary
    try {
      summary = JSON.parse(readFileSync(report, 'utf8'))
    } catch {
      console.error(`No Vitest report was written; check package '${pkg}'.`)
      exitCode = 1
    }
    if (summary && (summary.numPassedTests ?? 0) + (summary.numFailedTests ?? 0) === 0) {
      console.error('The explicit selection matched no runnable tests.')
      exitCode = 1
    }
  }
} finally {
  rmSync(outputDir, { recursive: true, force: true })
}
process.exitCode = exitCode
