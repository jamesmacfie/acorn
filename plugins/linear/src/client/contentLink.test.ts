import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentLinkRegistry, parseInAppTarget } from '@acorn/client-core/registries/contentLinks.ts'
import { linearContentLinkContribution } from './contentLink'

// Moved here from plugins/github with the recogniser itself.
let dispose: (() => void) | undefined
beforeAll(() => {
  const registered = contentLinkRegistry.register(linearContentLinkContribution)
  dispose = () => registered.dispose()
})
afterAll(() => dispose?.())

describe('linear content links', () => {
  it('recognises an issue link and normalises the identifier', () => {
    expect(parseInAppTarget('https://linear.app/acme/issue/cra-275/some-slug')).toEqual({ kind: 'linear', identifier: 'CRA-275' })
  })

  it('ignores a linear.app URL that is not an issue', () => {
    expect(linearContentLinkContribution.parse('https://linear.app/acme/project/abc')).toBeNull()
  })
})
