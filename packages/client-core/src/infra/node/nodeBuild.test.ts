import { describe, expect, it } from 'vitest'
import { SOURCE_BUILD } from '@acorn/protocol/node.ts'
import { buildLabel, compareBuild } from './nodeBuild'

const APP = '2026-10-15 cde782f12e98'

describe('compareBuild', () => {
  it('draws nothing until the node answers', () => {
    expect(compareBuild(undefined, APP)).toBeUndefined()
  })

  it('warns about two different stamps and about a node that reports nothing', () => {
    expect(compareBuild(APP, APP)).toBe('same')
    expect(compareBuild('2026-10-01 0123456789ab', APP)).toBe('different')
    expect(compareBuild(null, APP)).toBe('different')
    expect(compareBuild(null, SOURCE_BUILD)).toBe('different')
  })

  it('shows a plain line when either side runs from source', () => {
    expect(compareBuild(SOURCE_BUILD, APP)).toBe('unstamped')
    expect(compareBuild(APP, SOURCE_BUILD)).toBe('unstamped')
    expect(compareBuild(SOURCE_BUILD, SOURCE_BUILD)).toBe('same')
  })
})

it('names a build for the row', () => {
  expect(buildLabel(APP)).toBe(`build ${APP}`)
  expect(buildLabel(SOURCE_BUILD)).toBe('from source')
  expect(buildLabel(null)).toBe('an older build')
})
