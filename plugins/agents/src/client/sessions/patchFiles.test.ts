import { expect, it } from 'vitest'
import { patchFiles } from './patchFiles'

it('passes one file’s hunks through under its own path', () => {
  expect(patchFiles('src/a.ts', '@@ -1 +1 @@\n-a\n+b')).toEqual([{ path: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b' }])
})

it('splits a whole-turn git patch into its files, headers dropped', () => {
  const turn = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
    'diff --git a/new.ts b/new.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.ts',
    '@@ -0,0 +1 @@',
    '+hi',
    '',
  ].join('\n')
  expect(patchFiles(undefined, turn)).toEqual([
    { path: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b' },
    { path: 'logo.png', patch: '' },
    { path: 'new.ts', patch: '@@ -0,0 +1 @@\n+hi' },
  ])
})
