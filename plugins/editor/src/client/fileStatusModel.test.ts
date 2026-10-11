import { expect, it } from 'vitest'
import { projectFileStatus } from './fileStatusModel'

it('projects staged and unstaged paths once, including deleted descendants of unopened folders', () => {
  const status = projectFileStatus({
    kind: 'ready',
    changes: [
      { path: 'src/nested/a.ts', status: 'modified', staged: true },
      { path: 'src/nested/a.ts', status: 'modified', staged: false },
      { path: 'src/nested/gone.ts', status: 'deleted', staged: true },
      { path: 'src/conflict.ts', status: 'conflicted', staged: false },
      { path: 'src/new.ts', oldPath: 'old.ts', status: 'renamed', staged: true },
    ],
  })
  expect(status.files.get('src/nested/a.ts')).toMatchObject({ letter: 'M', label: 'Modified — Staged and unstaged' })
  expect(status.files.get('src/new.ts')?.label).toContain('renamed from old.ts')
  expect(status.folders.get('src')).toMatchObject({ count: 4, conflicts: 1, tone: 'danger' })
  expect(status.folders.get('src/nested')).toMatchObject({ count: 2, conflicts: 0 })
})
