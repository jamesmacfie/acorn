import { createRequire } from 'node:module'

// OpenTUI's render core is Zig behind `node:ffi`, which is a Node 26.4 builtin behind
// `--experimental-ffi` (vitest.config.ts passes it where it is accepted). On an older Node there is
// no renderer to draw to, so a test that draws has nothing to say — and says so rather than failing
// the repo's suite for a reason that has nothing to do with the change under test. See
// docs/future/terminal/findings.md § The runtime floor.
export const hasFfi = (() => {
  try {
    createRequire(import.meta.url)('node:ffi')
    return true
  } catch {
    return false
  }
})()
