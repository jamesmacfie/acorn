import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))

// Include source that never enters a test process; otherwise coverage omits it entirely.
const targets = [
  {
    name: '@acorn/protocol', folder: 'protocol', tests: ['src/plugin'],
    include: ['src/plugin/**/*.ts'],
  },
  {
    name: '@acorn/node-core', folder: 'node-core', tests: ['src/server/plugins'],
    include: ['src/server/plugins/**/*.ts'],
  },
  {
    name: '@acorn/client-core', folder: 'client-core', tests: ['src/host/frames'],
    include: ['src/host/frames/**/*.{ts,tsx}'],
  },
  {
    name: '@acorn/plugin-workflows', folder: 'workflows',
    tests: [
      'src/server/dispatch/dispatcher.test.ts',
      'src/server/dispatch/childLifecycle.test.ts',
      'src/server/processing/rules.test.ts',
      'src/server/runs/read/projection.test.ts',
      'src/server/schedules/service.test.ts',
    ],
    include: [
      'src/server/runs/runner.ts',
      'src/server/dispatch/dispatcher.ts',
      'src/server/dispatch/childLifecycle.ts',
      'src/server/processing/rules.ts',
      'src/server/runs/read/projection.ts',
      'src/server/schedules/service.ts',
    ],
  },
]

let failed = false
for (const target of targets) {
  const args = [
    '--filter', target.name, 'exec', 'vitest', 'run', ...target.tests,
    '--coverage.enabled',
    '--coverage.provider=v8',
    '--coverage.reporter=text-summary',
    '--coverage.reporter=json-summary',
    `--coverage.reportsDirectory=${join(root, '.coverage', target.folder)}`,
    ...target.include.map((pattern) => `--coverage.include=${pattern}`),
  ]
  const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) failed = true
}

if (failed) process.exitCode = 1
