/** @jsxImportSource @opentui/solid */
import type { CliRenderer } from '@opentui/core'
import type { QueryClient } from '@tanstack/solid-query'
import type { PluginTrustRequest } from '@acorn/client-core/host/plugins/distribution.ts'
import { _resetRequests, stubTransport, TASK } from './fixture'
import { setTerminalBadge } from './kit/notify'
import { RAW_KEYS } from './kit/render'
import { focusedRegion, focusedRenderable, type RegionRef } from './keys/regions'

// Booting client-core under Node against no node at all: the same seam, the same boot, a transport
// that answers from a fixture. Shared by the smoke test and the capture script so both draw the same
// screen, and so neither of them is the only thing that knows how the seam is installed.
//
// Everything client-core is imported dynamically, for the reason `main.tsx` gives: a module that
// reads `window.acorn` at its top level must not be evaluated before the seam exists.
export async function bootFixture(): Promise<{ task: typeof TASK }> {
  _resetRequests()
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
      // The notify group, because the topbar's count is written through it. `trackBadge` returns
      // early wherever `window.acorn.notify` is absent (client-core/features/notifications/badge.ts),
      // so a harness without one draws no count and the test asserting one could never pass.
      // `show` answers false rather than writing an escape sequence: a suite must not send OSC to
      // the terminal running it. The badge writes the same signal the real seam does
      // (./platform.ts, ./kit/notify.ts).
      notify: {
        show: async () => false,
        onActivate: () => () => {},
        setBadge: setTerminalBadge,
      },
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
/** One run of cells in a captured frame: what it says, what colour it says it in, and how many
 *  columns it takes.
 *
 *  `width` is not `text.length`. `captureCharFrame` gives us one character per grapheme, so a frame
 *  held as characters alone cannot see a column shift at all — `你|` comes back with the bar at index
 *  1 whether the wide character drew in one cell or two. The run frame is the only place the column
 *  count survives, which is why the golden capture reads it and why it must not be dropped again
 *  (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md § Spike 3). */
export type Span = { text: string; fg: { r: number; g: number; b: number }; attributes: number; width: number }

/** Where the keys are and what the line under them says (./keys/regions.ts). */
export type Caret = { region: RegionRef | null; text: string }

export type Screen = {
  frame: () => Promise<string>
  until: (text: string, seconds?: number) => Promise<string>
  press: (key: string, modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean }) => Promise<void>
  spans: () => Promise<Span[][]>
  caret: () => Promise<Caret>
  walk: (steps: number, each?: (caret: Caret) => unknown) => Promise<void>
  reach: (text: string, steps?: number) => Promise<boolean>
  resize: (width: number, height: number) => void
  quits: () => number
  /** The renderer, for the questions the store does not answer: the retained tree a case wants to
   *  count renderables in, and the caret OpenTUI is drawing (./diffLong.test.tsx,
   *  ./keys/keys.test.tsx). */
  renderer: CliRenderer
  done: () => void
}

// The renderer the last `renderFixture` built, so the next one can tear it down. Module state
// because a suite is one worker with many renders and the harness is what they have in common.
let previous: CliRenderer | null = null

export async function renderFixture(size: {
  width?: number
  height?: number
  supervised?: boolean
  /** Draw as if this run had spawned the node and its handshake had not landed yet: the footer says
   *  so and the broker has reported nothing (../chrome/nodeState.ts). */
  starting?: boolean
  pane?: string
  /** Seed the node's query cache before the shell mounts, which is what a warm start reads. Handed
   *  the same per-node client the shell renders under, so a query seeded here with a fresh timestamp
   *  is inside `clientFor`'s 30-second staleTime and no fetch is made for it at all. */
  cache?: (client: QueryClient) => void
  /** Bundles this device has never decided about, seeded into the distribution queue so the shell
   *  raises its trust overlay. Seeded here rather than by the caller because the reset below would
   *  clear anything seeded before the call (client-core/host/plugins/distribution.ts). */
  trust?: readonly PluginTrustRequest[]
} = {}): Promise<Screen> {
  const { createTestRenderer } = await import('@opentui/core/testing')
  const { render } = await import('@opentui/solid')
  const { installKeymap } = await import('./keys/install')
  const { installRenderGuard, RENDERER_LISTENER_CAP } = await import('./renderGuard')
  const { _resetCollections } = await import('./keys/collection')
  const { _resetRegions } = await import('./keys/regions')
  const { _resetLayoutState } = await import('@acorn/client-core/host/layouts/state.ts')
  const { _resetChrome } = await import('./chrome/state')
  const { _resetHints } = await import('./chrome/bindings')
  const { _resetRouter } = await import('./kit/router')
  const { clearAnnotations } = await import('@acorn/client-core/host/annotations/annotations.ts')
  const { setActiveTaskId, setSelectedSource } = await import('@acorn/client-core/features/tasks/tasks.ts')
  const { _resetPluginDistribution, _seedPendingTrust } = await import('@acorn/client-core/host/plugins/distribution.ts')
  const { setNodeStarting } = await import('./chrome/nodeState')
  // The collection store, the region list, the per-pane layout state, the path and which browse
  // source is showing are all module state, so two renders in one process would share a caret, a
  // focused region, a split position, a project and a rail selection. The real host has one render
  // for its lifetime; a suite has one per test.
  //
  // The last two came with the router: a path that survives a render is a project the next test did
  // not choose, and a source claimed off that path is a main panel the next test did not open
  // (./kit/router.ts, ./chrome/routing.ts).
  _resetCollections()
  _resetRegions()
  _resetLayoutState()
  _resetChrome()
  // …and the footer's cached answer, which is keyed on the engine among other things and would
  // otherwise be the previous render's hints until something moved (./chrome/bindings.ts).
  _resetHints()
  _resetRouter()
  // …and the marks another plugin put on this one's rows. The store remembers which key set it has
  // already asked about, so a render whose fixture contributes marks would be told the previous
  // render's answer — an empty one — and never ask (client-core/host/annotations).
  clearAnnotations()
  setActiveTaskId(null)
  setSelectedSource(null)
  setNodeStarting(size.starting ?? false)
  // …and the queue of bundles waiting on a trust decision, which is module state like the rest and
  // would otherwise leave the next test in the file staring at the previous one's dialog.
  _resetPluginDistribution()
  if (size.trust?.length) _seedPendingTrust(size.trust)
  await bootFixture()
  // Which pane the fixture task opens on. The roster has eight of them now, so "the pane" is a choice
  // rather than the only one there is, and a test that does not make it gets whatever the task's saved
  // layout puts first (../chrome/panes.ts § shownPane).
  if (size.pane) {
    const { dispatchLayout } = await import('@acorn/client-core/features/tasks/tasks.ts')
    const { activateTaskSignals } = await import('@acorn/client-core/features/tasks/activate.ts')
    const { paneContribution } = await import('@acorn/client-core/host/registries/panes/panes.ts')
    // Naming a pane is also an explicit request for the fixture task. Production now defaults to
    // the first Menu source, so tests of a task pane must state the other half of their setup rather
    // than relying on the old startup side effect in Shell.
    activateTaskSignals(TASK)
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
  // The roster, which production loads after its first frame (./roster.ts). A suite awaits it
  // before rendering: a test asserts on one frame, so a screen that fills a beat later is a flake
  // rather than a finding, and every plugin surface under test has to be registered before the
  // command layer builds its first table.
  const { installRoster } = await import('./roster')
  installRoster()
  // Contributions nobody ships, and nothing at all unless a test asked for one
  // (./fixtureExtensions.tsx). After the roster `App.tsx` registers, because a delivery needs the point
  // its owner declared while activating, and before the render, because a chord has to be in the
  // keybinding registry when the command layer builds its first table.
  const { installFixtureExtensions } = await import('./fixtureExtensions')
  installFixtureExtensions()

  // The renderer first and the tree second, rather than `testRender`, which builds both at once. The
  // keymap has to be installed before anything mounts: a layout, a collection and a trap all register
  // their layer as they draw, and a layer registered against no engine is silently dropped.
  installRenderGuard()
  // Whatever the last render left behind. A test that fails an assertion before its `done()` never
  // tears its renderer down, so the Solid root stays mounted, its `onCleanup` never runs, and the
  // next render in the same worker throws "command contribution already registered" from the shell's
  // `onMount` — one red test turning into three, none of which names the first. Tearing down here
  // costs nothing when the previous test was tidy (@opentui/solid disposes the root on `destroy`).
  previous?.destroy()
  const { renderer, mockInput, flush, captureCharFrame, captureSpans, resize } = await createTestRenderer({
    width: size.width ?? 80,
    height: size.height ?? 24,
    // The keyboard protocol the app asks for (./main.tsx). Without it a legacy terminal sends one byte
    // for Return with Ctrl and Return without it, so `commit` is a chord nobody can press — and a
    // suite driving a different protocol from production is testing a different keyboard.
    kittyKeyboard: true,
    // And the same answer about focus, for the same reason: a suite whose renderer focuses on a click
    // by itself is a suite in which the store is not the only owner of the keys
    // (./keys/regions.ts § Clicks are hit tests).
    autoFocus: false,
  })
  previous = renderer
  renderer.setMaxListeners(RENDERER_LISTENER_CAP)
  installKeymap(renderer)
  let quits = 0
  // The same client the shell reads in production: one per node, built by client-core's fleet
  // (client-core/infra/node/fleet.ts § clientFor). Cleared per render, because a suite is one process
  // with many renders and a cache entry from the last test is a fixture the next one did not write.
  const { clientFor } = await import('@acorn/client-core/infra/node/fleet.ts')
  const { client } = clientFor('node-1')
  client.clear()
  size.cache?.(client)
  await render(() => <App client={client} nodeId="node-1" supervised={size.supervised ?? false} onQuit={() => { quits += 1 }} />, renderer)
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
  // on an empty pane (docs/tui.md). Each turn is cheap: `flush`
  // resolves as soon as the render loop is idle, so this is twenty chances for a promise to land rather
  // than four seconds of waiting.
  for (let turn = 0; turn < 20; turn += 1) await settle(200)
  const frame = async (): Promise<string> => {
    await settle(500)
    return captureCharFrame()
  }

  const press = async (key: string, modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean }): Promise<void> => {
    mockInput.pressKey(RAW_KEYS[key] ?? key, modifiers)
    // A real wait before the render loop, not just a flush. A lone Escape is the start of every
    // escape sequence there is, and the terminal's parser holds it until it is sure nothing
    // follows; flushing the render loop does not make that timer run.
    await new Promise((done) => setTimeout(done, 80))
    await settle(500)
  }

  /**
   * Where the keys are, and the cells a reader would look at to see it.
   *
   * The focused renderable's own row and its own columns. The row is where it drew itself, since a
   * `Row` puts the caret there and a `Button` draws itself lit there. The columns matter because a
   * terminal row is the width of the screen and the screen is the rail beside a pane: at 120 cells a
   * rail row's line carries the pane's text as well, so a match against the whole row answers for
   * something the keys are nowhere near. That is what made a `reach` on a wide screen stop on the
   * wrong thing and pass a precondition it had not met.
   *
   * The row holding a `\u203a` is the fallback, for the moment focus is on a region's own box and
   * nothing is lit at all. That one keeps its full width, because there is no node to take columns
   * from.
   */
  const caret = async (): Promise<Caret> => {
    const lines = (await frame()).split('\n')
    const node = focusedRenderable()
    const row = node && !node.isDestroyed ? lines[node.y] : undefined
    const own = row === undefined || !node ? undefined : row.slice(node.x, node.x + node.width)
    return { region: focusedRegion(), text: own ?? lines.find((line) => line.includes('\u203a')) ?? '' }
  }

  /**
   * Press the screen's own stops, in one fixed order, calling back after each press.
   *
   * Tab major and `\u2193` minor: inside whichever region has the keys, Down until the caret stops
   * moving, then Tab to the next region and start again. A failure is therefore reproducible by
   * hand — press the same keys in the same order and the same thing is under the caret.
   *
   * Down rather than a breadth-first fan of Down, Right and Enter, which the design asked for.
   * What the property is over is `_allStops()`, and that is `stopsIn` per region: a panel's contents
   * are the level below and are not in it. Right and Enter only reach that level, so they would cost
   * presses and prove nothing (docs/tui.md § The invariants).
   *
   * `each` returning `true` ends the walk where it stands, which is how `reach` stops on what it
   * came for rather than spending the whole budget behind it.
   */
  const walk = async (steps: number, each?: (caret: Caret) => unknown): Promise<void> => {
    const seen = new Set<unknown>()
    let previous: unknown = null
    let repeats = 0
    for (let step = 0; step < steps; step += 1) {
      if (await each?.(await caret())) return
      const node = focusedRenderable()
      // Two kinds of "this region is done", and both need saying. A wall answers Down with the same
      // renderable; a collection answers it with the row it wrapped around to, which is a different
      // renderable the walk has already stood on. Without the second, a list of five rows is where
      // the walk spends its whole budget.
      repeats = node === previous || seen.has(node) ? repeats + 1 : 0
      seen.add(node)
      previous = node
      const done = repeats >= 2
      await press(done ? 'TAB' : 'ARROW_DOWN')
      if (done) { repeats = 0; previous = null }
    }
  }

  return {
    frame,
    caret,
    walk,
    /** Walk until the caret's line says this, or the budget is spent. Stops where it lands. */
    reach: async (text: string, steps = 40): Promise<boolean> => {
      let found = false
      await walk(steps, (here) => (found = here.text.includes(text)))
      return found
    },
    /**
     * The frame, once it holds this text, or the last one taken if it never does.
     *
     * A real wait, not another flush: what is outstanding is a query and, on a cold worker, the
     * compile of a `lazy()` and everything it imports. Turning the render loop makes neither finish.
     *
     * Take one where a test reads a pane's own data. `frame()` alone is a race that passes on a quiet
     * machine and fails when the suite runs beside eleven others, which is exactly the failure that
     * says nothing about the change under test. Fifteen seconds by default, because a cold compile of
     * the agents pane is seconds; `seconds` raises it for a test that mounts more than one lazy tree.
     */
    until: async (text: string, seconds = 15): Promise<string> => {
      let drawn = await frame()
      for (let tries = 0; tries < seconds * 4 && !drawn.includes(text); tries += 1) {
        await new Promise((done) => setTimeout(done, 250))
        drawn = await frame()
      }
      return drawn
    },
    // A single character is itself; a named key is OpenTUI's own spelling for one, which is upper
    // case (`KeyCodes.RETURN`). Anything else is typed one letter at a time, silently, which is a
    // good hour to save the next person — and a chord is the key plus a modifiers object, never the
    // string `'ctrl+k'`, which types five letters and a `k`.
    press,
    /** The frame as coloured runs rather than characters.
     *
     *  `frame()` answers what is on the screen and nothing about what colour it is, so every rule in
     *  the role table — the accent on a focused border, the green on an inserted line, the grey on a
     *  muted one — was untested. A terminal that draws the right characters in the wrong colour is a
     *  terminal a reader cannot use, which is the whole of the light-background bug
     *  (./appearance.ts). */
    spans: async (): Promise<Span[][]> => {
      await settle(500)
      return captureSpans().lines.map((line) => line.spans.map((span) => ({
        text: span.text,
        fg: { r: span.fg.r, g: span.fg.g, b: span.fg.b },
        attributes: span.attributes,
        width: span.width,
      })))
    },
    resize,
    renderer,
    /** How many times the shell asked to quit. Counted rather than performed: a suite that really
     *  exited would take the runner with it. */
    quits: () => quits,
    done: () => {
      if (previous === renderer) previous = null
      renderer.destroy()
    },
  }
}
