// Run with `node --test` from this folder.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decide } from './policy.js'

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
