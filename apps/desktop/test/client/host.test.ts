import { expect, test } from 'vitest'
import { HOST } from '@acorn/client-core/kit/tokens/support.ts'

// `HOST` is supplied per host package at build time now (client-core kit/tokens/support.ts): the
// desktop's Vite config defines it as `dom` and apps/tui's as `tui`, and `Only` and `Fallback` are
// what read it. Making it configurable made it possible to get wrong, so this is the desktop's half
// of the pin. It asserts the fallback rather than the define — a build here that says anything but
// `dom` is a build whose kit would hide half of itself.
test('the desktop draws to the DOM host', () => {
  expect(HOST).toBe('dom')
})
