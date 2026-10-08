import { expect, it } from 'vitest'
import { tabLabels } from './tabLabels'

it('uses the shortest distinguishing parent suffix as tabs enter and leave', () => {
  const paths = ['src/app/index.ts', 'test/app/index.ts', 'lib/index.ts', 'README.md']
  expect([...tabLabels(paths)]).toEqual([
    ['src/app/index.ts', 'index.ts — src/app'],
    ['test/app/index.ts', 'index.ts — test/app'],
    ['lib/index.ts', 'index.ts — lib'],
    ['README.md', 'README.md'],
  ])
  expect(tabLabels(paths.slice(1)).get('test/app/index.ts')).toBe('index.ts — app')
  expect(tabLabels(['test/app/index.ts']).get('test/app/index.ts')).toBe('index.ts')
})
