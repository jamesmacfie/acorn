import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_WORKER } from './appScheme'

// The one pattern in the app whose failure mode is a quiet security-relevant mismatch, in both
// directions, which is why it is pinned against literal names the build actually emitted.
//
// Too loose and the ~270-byte main-thread wrapper Vite emits from the same source module picks up
// `wasm-unsafe-eval`. Too tight and the real worker entry gets the document's policy instead, Oniguruma
// fails inside it, and the highlighter silently falls back to the slow main-thread engine, exactly the
// class of failure this whole area was rebuilt to make loud.
describe('the highlight worker CSP pattern', () => {
  it('matches the worker entry the build emits', () => {
    expect(HIGHLIGHT_WORKER.test('/assets/worker-highlighter.worker-D3loQdBc.js')).toBe(true)
  })

  it('does NOT match the main-thread wrapper emitted from the same module', () => {
    expect(HIGHLIGHT_WORKER.test('/assets/highlighter.worker-ChQ9mxUb.js')).toBe(false)
  })

  it("does NOT match Monaco's workers, which have no use for WebAssembly", () => {
    for (const name of ['editor.worker', 'json.worker', 'css.worker', 'html.worker', 'ts.worker']) {
      expect(HIGHLIGHT_WORKER.test(`/assets/worker-${name}-D3loQdBc.js`)).toBe(false)
    }
  })

  it('is anchored, so no other path can reach the relaxed policy by containing the name', () => {
    expect(HIGHLIGHT_WORKER.test('/assets/x/worker-highlighter.worker-abc.js')).toBe(false)
    expect(HIGHLIGHT_WORKER.test('/assets/worker-highlighter.worker-abc.js.map')).toBe(false)
    expect(HIGHLIGHT_WORKER.test('/plugin/worker-highlighter.worker-abc.js')).toBe(false)
  })
})
