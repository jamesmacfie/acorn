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

/** The whole shell, rendered to a cell buffer at 80 by 24, with the keymap installed on it.
 *
 *  The smoke and chrome tests assert on what comes back and drive it with keys; `capture.tsx` prints
 *  one frame. Both go through the same function, so the screenshot is of the thing under test.
 *
 *  What it draws is the fixture node's one task and its notes pane, because that is the roster
 *  `App.tsx` registers. The chrome around it is real: the same rail, strip, palette and footer a
 *  person gets. */
export async function renderFixture(size: { width?: number; height?: number; supervised?: boolean; pane?: string } = {}): Promise<{ frame: () => Promise<string>; press: (key: string, modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean }) => Promise<void>; resize: (width: number, height: number) => void; quits: () => number; done: () => void }> {
  const { createTestRenderer } = await import('@opentui/core/testing')
  const { render } = await import('@opentui/solid')
  const { installKeymap } = await import('./keys/install')
  const { _resetCollections } = await import('./keys/collection')
  const { _resetRegions } = await import('./keys/regions')
  const { _resetLayoutState } = await import('@acorn/client-core/host/layouts/state.ts')
  const { _resetChrome } = await import('./chrome/state')
  // The collection store, the region list and the per-pane layout state are all module state, so two
  // renders in one process would share a caret, a focused region and a split position. The real host
  // has one render for its lifetime; a suite has one per test.
  _resetCollections()
  _resetRegions()
  _resetLayoutState()
  _resetChrome()
  await bootFixture()
  // Which pane the fixture task opens on. The roster has eight of them now, so "the pane" is a choice
  // rather than the only one there is, and a test that does not make it gets whatever the task's saved
  // layout puts first (../chrome/panes.ts § shownPane).
  if (size.pane) {
    const { dispatchLayout } = await import('@acorn/client-core/features/tasks/tasks.ts')
    const { paneContribution } = await import('@acorn/client-core/host/registries/panes/panes.ts')
    dispatchLayout(TASK.id, { type: 'show', pane: size.pane })
    // …and wait for its code, the pane's and every region's. A pane and each of its regions is a
    // `lazy()`, and under the test transform the import is a compile rather than a read of one bundled
    // chunk: the agents pane pulls a highlighter and the editor pulls CodeMirror, which is seconds. A
    // suite that took its frame before that finished would be asserting on a blank pane and calling it
    // a finding. The real host has the same wait and shows the pane's `Suspense` fallback through it.
    const pane = paneContribution(size.pane)
    type Lazy = { preload?: () => Promise<unknown> }
    const regions = Object.values((pane as { regions?: Record<string, unknown> } | undefined)?.regions ?? {})
    await Promise.all([pane?.component as Lazy | undefined, ...regions as Lazy[]]
      .map((entry) => entry?.preload?.()))
  }
  const { App } = await import('./App')

  // The renderer first and the tree second, rather than `testRender`, which builds both at once. The
  // keymap has to be installed before anything mounts: a layout, a collection and a trap all register
  // their layer as they draw, and a layer registered against no engine is silently dropped.
  const { renderer, mockInput, flush, captureCharFrame, resize } = await createTestRenderer({
    width: size.width ?? 80,
    height: size.height ?? 24,
  })
  installKeymap(renderer)
  let quits = 0
  await render(() => <App nodeId="node-1" supervised={size.supervised ?? false} onQuit={() => { quits += 1 }} />, renderer)
  // Bounded, and the frame is taken either way. A tree that never settles is itself a finding, and a
  // capture that hangs says nothing about which node did it.
  const settle = (ms: number) => Promise.race([flush(), new Promise((done) => setTimeout(done, ms))])
  await settle(3000)
  // OpenTUI patches `console.*` and pops its own overlay over the frame when anything logs. Whatever
  // logged is worth seeing on stderr; it is not worth drawing over the screen.
  renderer.console.deactivate()
  renderer.console.hide()
  await settle(1000)
  // Twenty more turns of the loop. A pane's own data is a route and a store, not a prop, and the first
  // render in a fresh worker also pays for compiling every module the pane pulls in — so the settles
  // above come back before the pane has anything in it, and the first test in every file was asserting
  // on an empty pane (docs/future/terminal/phase-6-panes-sweep.md). Each turn is cheap: `flush`
  // resolves as soon as the render loop is idle, so this is twenty chances for a promise to land rather
  // than four seconds of waiting.
  for (let turn = 0; turn < 20; turn += 1) await settle(200)
  return {
    frame: async () => {
      await settle(500)
      return captureCharFrame()
    },
    // A single character is itself; a named key is OpenTUI's own spelling for one, which is upper
    // case (`KeyCodes.RETURN`). Anything else is typed one letter at a time, silently, which is a
    // good hour to save the next person — and a chord is the key plus a modifiers object, never the
    // string `'ctrl+k'`, which types five letters and a `k`.
    press: async (key: string, modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean }) => {
      mockInput.pressKey(key, modifiers)
      // A real wait before the render loop, not just a flush. A lone Escape is the start of every
      // escape sequence there is, and the terminal's parser holds it until it is sure nothing
      // follows; flushing the render loop does not make that timer run.
      await new Promise((done) => setTimeout(done, 80))
      await settle(500)
    },
    resize,
    /** How many times the shell asked to quit. Counted rather than performed: a suite that really
     *  exited would take the runner with it. */
    quits: () => quits,
    done: () => renderer.destroy(),
  }
}
