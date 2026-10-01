import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
// The desktop already declares this loader. It lets the child exercise the actual TypeScript
// callers, including workflow imports, without moving a hang-prone parse into Vitest's process.
const loader = createRequire(new URL('apps/desktop/package.json', root)).resolve('tsx')
const callers = [
  ['packages/node-core/src/server/runConfig.ts', `
    const result = caller.loadRepoConfig(null, null, { devScript: 'owner-command' }, text)
    assert.equal(result.errors.length, 1)
    assert.equal(result.runTargets[0].command, 'owner-command')
  `],
  ['plugins/docker/src/server/dockerConfig.ts', `
    assert.deepEqual(caller.parseDockerConfig(text), {})
  `],
  ['plugins/workflows/src/server/definitions/files.ts', `
    const errors = []
    assert.equal(caller.parseWorkflowToml(text, 'regression', 'repo', errors), null)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].source, 'repo:regression')
  `],
] as const

it.each(callers)('%s rejects an unterminated final comment within the child deadline', (path, assertions) => {
  const source = `
    import assert from 'node:assert/strict'
    const caller = await import(${JSON.stringify(new URL(path, root).href)})
    for (const text of ['a=[1 #', 'a={b=1 #']) { ${assertions} }
    console.log('rejected both malformed documents')
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
  expect(result.stdout).toContain('rejected both malformed documents')
}, 15_000)
