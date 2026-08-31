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
export async function renderFixture(): Promise<{ frame: () => Promise<string>; press: (key: string) => Promise<void>; done: () => void }> {
  const { testRender } = await import('@opentui/solid')
  const { installKeymap } = await import('./keys')
  const { _resetCollections } = await import('./kit/collection')
  // The collection store is module state, so two renders in one process share a caret. The real host
  // has one render for its lifetime; a suite has one per test.
  _resetCollections()
  const { task } = await bootFixture()
  const { App } = await import('./App')
  const { renderer, mockInput, flush, captureCharFrame } = await testRender(() => <App task={task} />, { width: 80, height: 24 })
  installKeymap(renderer, () => {})
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
    done: () => renderer.destroy(),
  }
}
