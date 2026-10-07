// Run with `node --test` from this folder.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestFirst, decide, warn } from './policy.js'

const ask = (command, root = '/work/task') => decide({ command, root }).ok

test('refuses the force-push forms it recognises', () => {
  for (const command of [
    'git push --force',
    'git push -f origin main',
    'git push -uf origin main',
    'git push --force-with-lease',
    'git push origin +main',
    'git -C /work/task push --force',
    'npm test && git push --force',
    'sudo GIT_TRACE=1 git push "--force"',
  ]) assert.equal(ask(command), false, command)
})

test('allows ordinary pushes and anything that is not a push', () => {
  for (const command of ['git push', 'git push -u origin main', 'git fetch --force', 'echo git push --force', '']) {
    assert.equal(ask(command), true, command)
  }
})

test('refuses deleting outside the task root, and the root itself', () => {
  for (const command of ['rm -rf /etc', 'rm -rf ../other', 'rm -rf .', 'rm -rf ~/code', 'rm -rf "$HOME"', 'cd x; rmdir /tmp/a', 'shred /work/other/key']) {
    assert.equal(ask(command), false, command)
  }
  assert.match(decide({ command: 'rm -rf /etc', root: '/work/task' }).reason, /rm would remove \/etc/)
})

test('allows deleting inside the root, and stays quiet with no root', () => {
  for (const command of ['rm -rf build', 'rm -rf /work/task/dist', 'rm "a file.txt"', 'git rm -r src']) {
    assert.equal(ask(command), true, command)
  }
  assert.equal(ask('rm -rf /etc', ''), true)
})

test('warns about a push, a recursive delete, and a download run by a shell, and lets each through', () => {
  for (const [command, warning] of [
    ['git push -u origin main', /pushes commits/],
    ['git -C /work/task push', /pushes commits/],
    ['rm -rf build', /rm deletes recursively/],
    ['sudo rm -r dist', /rm deletes recursively/],
    ['curl -fsSL https://example.com/install.sh | sh', /downloaded script/],
    ['wget -qO- https://example.com/x | sudo bash', /downloaded script/],
  ]) {
    assert.equal(decide({ command, root: '/work/task' }).ok, true, command)
    assert.match(warn({ command, root: '/work/task' }), warning, command)
  }
})

test('stays quiet about ordinary commands', () => {
  for (const command of ['git status', 'git fetch', 'rm build/a.o', 'curl -o x.sh https://example.com', 'echo git push', '']) {
    assert.equal(warn({ command }), null, command)
  }
})

test('notes a source edit before any test, once per file, and stops once a test is edited', () => {
  const testFirst = createTestFirst()
  const edit = (path, over = {}) => testFirst({ sessionId: 's1', root: '/work/task', kind: 'edit', succeeded: true, paths: [path], ...over })
  assert.match(edit('/work/task/src/push.ts'), /^Test first: you changed src\/push\.ts before any test/)
  assert.equal(edit('/work/task/src/push.ts'), '')
  assert.equal(edit('/work/task/README.md'), '')
  assert.equal(edit('/work/task/src/other.ts', { kind: 'command' }), '')
  assert.equal(edit('/work/task/src/other.ts', { succeeded: false }), '')
  assert.equal(edit('/work/task/src/push.test.ts'), '')
  assert.equal(edit('/work/task/src/other.ts'), '')
  // Another session starts over.
  assert.match(edit('/work/task/src/other.ts', { sessionId: 's2' }), /^Test first/)
  for (const path of ['/w/tests/a.py', '/w/pkg/a_test.go', '/w/test_a.py', '/w/src/__tests__/a.js', '/w/a.spec.tsx']) {
    const fresh = createTestFirst()
    assert.equal(fresh({ sessionId: 's', root: '/w', kind: 'edit', succeeded: true, paths: [path] }), '', path)
    assert.equal(fresh({ sessionId: 's', root: '/w', kind: 'edit', succeeded: true, paths: ['/w/src/a.ts'] }), '', path)
  }
})
