/** @jsxImportSource @opentui/solid */
import { stubTransport, TASK } from './fixture'

// Booting client-core under Node against no node at all: the same seam, the same boot, a transport
// that answers from a fixture. Shared by the smoke test and the capture script so both draw the same
// screen, and so neither of them is the only thing that knows how the seam is installed.
//
// Everything client-core is imported dynamically, for the reason `main.tsx` gives: a module that
// reads `window.acorn` at its top level must not be evaluated before the seam exists.
export async function bootFixture(): Promise<{ task: typeof TASK }> {
  const transport = stubTransport()
  ;(globalThis as { window?: unknown }).window = {
    acorn: {
      platform: process.platform,
      nodeFetch: transport.fetch,
      nodeAbort: () => {},
      nodeSend: () => {},
      onNodeFrame: () => () => {},
      onNodeStatus: (cb: (status: unknown) => void) => {
        cb({ nodeId: 'node-1', state: 'online' })
        return () => {}
      },
      fleetList: async () => ({
        nodes: [{ nodeId: 'node-1', label: 'fixture', endpoint: 'https://127.0.0.1:1', local: true }],
        statuses: [{ nodeId: 'node-1', state: 'online' }],
      }),
    },
  }
  const { selectActiveNode } = await import('@acorn/client-core/infra/node/activeNode.ts')
  await selectActiveNode()
  return { task: TASK }
}

/** The fixture pane, rendered to a cell buffer at 80 by 24, with the keymap installed on it.
 *
 *  The smoke test asserts on what comes back and drives it with keys; `capture.tsx` prints one frame.
 *  Both go through the same function, so the screenshot is of the thing under test. */
export async function renderFixture(size: { width?: number; height?: number } = {}): Promise<{ frame: () => Promise<string>; press: (key: string) => Promise<void>; resize: (width: number, height: number) => void; done: () => void }> {
  const { createTestRenderer } = await import('@opentui/core/testing')
  const { render } = await import('@opentui/solid')
  const { installKeymap } = await import('./keys/install')
  const { _resetCollections } = await import('./keys/collection')
  const { _resetRegions } = await import('./keys/regions')
  const { _resetLayoutState } = await import('@acorn/client-core/host/layouts/state.ts')
  // The collection store, the region list and the per-pane layout state are all module state, so two
  // renders in one process would share a caret, a focused region and a split position. The real host
  // has one render for its lifetime; a suite has one per test.
  _resetCollections()
  _resetRegions()
  _resetLayoutState()
  const { task } = await bootFixture()
  const { App } = await import('./App')

  // The renderer first and the tree second, rather than `testRender`, which builds both at once. The
  // keymap has to be installed before anything mounts: a layout, a collection and a trap all register
  // their layer as they draw, and a layer registered against no engine is silently dropped.
  const { renderer, mockInput, flush, captureCharFrame, resize } = await createTestRenderer({
    width: size.width ?? 80,
    height: size.height ?? 24,
  })
  installKeymap(renderer)
  await render(() => <App task={task} />, renderer)
  // Bounded, and the frame is taken either way. A tree that never settles is itself a finding, and a
  // capture that hangs says nothing about which node did it.
  const settle = (ms: number) => Promise.race([flush(), new Promise((done) => setTimeout(done, ms))])
  await settle(3000)
  // OpenTUI patches `console.*` and pops its own overlay over the frame when anything logs. Whatever
  // logged is worth seeing on stderr; it is not worth drawing over the screen.
  renderer.console.deactivate()
  renderer.console.hide()
  await settle(1000)
  return {
    frame: async () => {
      await settle(500)
      return captureCharFrame()
    },
    // A single character is itself; a named key is OpenTUI's own spelling for one, which is upper
    // case (`KeyCodes.RETURN`). Anything else is typed one letter at a time, silently, which is a
    // good hour to save the next person.
    press: async (key: string) => {
      mockInput.pressKey(key)
      await settle(500)
    },
    resize,
    done: () => renderer.destroy(),
  }
}
