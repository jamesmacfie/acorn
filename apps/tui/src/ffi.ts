import { createRequire } from 'node:module'
import { drawsOwn } from './painter'

// OpenTUI's render core is Zig behind `node:ffi`, which is a Node 26.4 builtin behind
// `--experimental-ffi` (vitest.config.ts passes it where it is accepted). On an older Node there is
// no renderer to draw to, so a test that draws has nothing to say — and says so rather than failing
// the repo's suite for a reason that has nothing to do with the change under test. See
// docs/tui.md § The runtime floor.
export const hasFfi = (() => {
  try {
    createRequire(import.meta.url)('node:ffi')
    return true
  } catch {
    return false
  }
})()

/**
 * Can this build draw at all?
 *
 * The question every suite that renders actually meant. Under OpenTUI it is the FFI one above; under
 * our own painter it is always yes, because there is no native half to reach — which is the whole
 * point of the programme and the reason the gate had to grow a second answer rather than stay a
 * synonym for `hasFfi` (./painter.ts, docs/future/terminal-rewrite/README.md § Done when).
 */
export const canDraw = drawsOwn() || hasFfi
