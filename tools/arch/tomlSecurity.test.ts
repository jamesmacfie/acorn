import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
// The desktop already declares this loader. It lets the child exercise the actual TypeScript
// callers, including workflow imports, without moving a hang-prone parse into Vitest's process.
const loader = createRequire(new URL('apps/desktop/package.json', root)).resolve('tsx')
// Each caller with the assertions for a malformed document, then for a large valid one.
const callers = [
  [
    'packages/node-core/src/server/runConfig.ts',
    `
    const result = caller.loadRepoConfig(null, null, { devScript: 'owner-command' }, text)
    assert.equal(result.errors.length, 1)
    assert.equal(result.runTargets[0].command, 'owner-command')
  `,
    `
    const result = caller.loadRepoConfig(null, null, { devScript: 'owner-command' }, text)
    assert.deepEqual(result.errors, [])
    assert.equal(result.runTargets[0].command, 'owner-command')
  `,
  ],
  [
    'plugins/docker/src/server/dockerConfig.ts',
    `
    assert.deepEqual(caller.parseDockerConfig(text), {})
  `,
    `
    assert.deepEqual(caller.parseDockerConfig(text), {})
  `,
  ],
  [
    'plugins/workflows/src/server/definitions/files.ts',
    `
    const errors = []
    assert.equal(caller.parseWorkflowToml(text, 'regression', 'repo', errors), null)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].source, 'repo:regression')
  `,
    `
    const errors = []
    assert.equal(caller.parseWorkflowToml(text, 'regression', 'repo', errors), null)
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /Incompatible workflow/)
  `,
  ],
] as const

function runCaller(path: string, body: string) {
  const source = `
    import assert from 'node:assert/strict'
    const caller = await import(${JSON.stringify(new URL(path, root).href)})
    ${body}
    console.log('caller finished')
  `
  const result = spawnSync(process.execPath, ['--import', loader, '--input-type=module', '--eval', source], {
    cwd: fileURLToPath(root),
    timeout: 10_000,
    killSignal: 'SIGKILL',
    maxBuffer: 128 * 1024,
    encoding: 'utf8',
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.signal, result.stderr).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('caller finished')
}

it.each(callers)(
  '%s rejects an unterminated final comment within the child deadline',
  (path, malformed) => {
    runCaller(path, `for (const text of ['a=[1 #', 'a={b=1 #']) { ${malformed} }`)
  },
  15_000,
)

// GHSA-r4xh-jqrq-34v2: smol-toml up to 1.8.0 scanned the rest of the document for every key, so a
// flat list of plain keys parsed in quadratic time.
it.each(callers)(
  '%s parses a few megabytes of plain keys within the child deadline',
  (path, _malformed, large) => {
    runCaller(path, `const text = Array.from({ length: 400_000 }, (_, i) => 'k' + i + ' = 1').join('\\n'); ${large}`)
  },
  15_000,
)
