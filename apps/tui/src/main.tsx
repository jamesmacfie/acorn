/** @jsxImportSource @acorn/tui/jsx */
import { parseArgs } from 'node:util'
import type { Address } from '@acorn/client-core/host/registries/commands/addresses'
import { createLogger } from '@acorn/client-core/infra/telemetry'
import { latestSignal } from '@acorn/client-core/kit/lib/latestSignal'
import { bootMark, heldLines, holdLine, printBootMarks } from './boot'
import { render } from './tree/renderer'
import { installPlatform } from './platform'
import { openNode } from './node/open'
import { installKeymap } from './keys/install'
import { COMMAND } from './keys/tiers'
import { openTerminalRenderer, type Renderer } from './renderer'

// `acorn`.
//
//   acorn                          the node for this machine's data root: attach if one is running,
//                                  start and supervise one if not
//   acorn --node <https://host>     pair with a node elsewhere, then open it
//   acorn --node <name>             open a node this device already paired with
//
// The shell is whole (docs/tui/chrome.md § The screen): a rail of tasks, a pane strip, a palette, a footer
// that says what the keyboard will do, and the same client plugins the desktop registers.

// The boot account and the held lines are `./boot.ts`, which says why they are held and how they
// also become spans.
const log = createLogger('acorn')
// An agent-built app card runs OpenUI's language core here, which reads this process's environment
// for its opt-in usage telemetry. Someone who opted in for their own OpenUI project from this shell
// mustn't have Acorn report too.
process.env.OPENUI_TELEMETRY_DISABLED = '1'

const { values } = parseArgs({
  options: {
    node: { type: 'string' },
    task: { type: 'string' },
    link: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})
if (values.help) {
  process.stdout.write(
    'Usage: acorn [--node <name|id|https://endpoint>] [--task <id>]\n       acorn --link <acorn://node/place>\n',
  )
  process.exit(0)
}
if (values.link !== undefined && (values.task !== undefined || values.node !== undefined)) {
  process.stderr.write('acorn: --link cannot be used with --task or --node.\n')
  process.exit(2)
}
let link: Address | undefined
if (values.link !== undefined) {
  const { parseLink } = await import('@acorn/client-core/host/registries/commands/addresses')
  const parsed = parseLink(values.link)
  if (parsed.kind === 'refused') {
    process.stderr.write(`acorn: ${parsed.reason}.\n`)
    process.exit(2)
  }
  link = parsed.address
  if (link.kind === 'new-task') {
    process.stderr.write('acorn: Open this new-task link in the desktop app to review and confirm it.\n')
    process.exit(2)
  }
}

// Before the renderer: pairing asks a question on stdin, and it is the one thing here that does. The
// renderer doesn't wait for a node this run started: `openNode` returns as soon as the child is
// spawned, and the shell draws from the persisted cache while it boots
// (./node/open.ts, docs/tui/process.md § Attach or start).
const opened = await openNode(
  link ? (link.nodeId === 'local' ? undefined : link.nodeId) : values.node,
  undefined,
  !link,
).catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
// The node: attached to, or spawned and still booting.
bootMark('node open')

let leaving = false
// `opened.held` — a started child's stderr — is held the same way this process's own lines are, in
// `supervise.ts`, and read at print time because it grows for the life of the run (./boot.ts).
const platform = installPlatform(opened, () => void quit())

// This is a live client running under Node. Query Core may have been imported by a static boot
// dependency before the platform installed `window`, so its module-time server detection can be
// stale even though Solid's web entry is the client build. Set the runtime explicitly before any
// query observer mounts.
const { environmentManager } = await import('@tanstack/solid-query')
environmentManager.setIsServer(() => false)

// Nothing that reaches the node may be imported before the seam exists: an import is evaluated once,
// and a module that reads `window.acorn` at its top level would read it before the line above ran.
const { selectActiveNode, setActiveNode } = await import('@acorn/client-core/infra/node/activeNode.ts')
const { clientFor, nodeState, setCacheStorage } = await import('@acorn/client-core/infra/node/fleet.ts')
const { fileCacheStorage } = await import('./node/cache')
const { markNodeRecovered, setNodeStarting } = await import('./chrome/nodeState')
const { refreshNodeQueries } = await import('./chrome/recovery')
const { startClientRuntime } = await import('@acorn/client-core/host/clientRuntime.ts')
const { themeColorTokens } = await import('@acorn/client-core/infra/styles/themeColorTokens.ts')
const { paletteFor, reportsTruecolor, setPalette } = await import('./appearance')
const { createEffect, createRoot, createSignal } = await import('solid-js')
const { setHostFocused } = await import('@acorn/client-core/infra/platform')
const [linkReady, setLinkReady] = createSignal(false)

// The query cache persists to files rather than to IndexedDB, which there is none of here. Installed
// before `selectActiveNode`, because that is what builds the first node's cache.
setCacheStorage(fileCacheStorage())

// Which node this run addresses, said out loud before the fleet is read. `selectActiveNode` keeps a
// selection it still recognises and otherwise prefers the home node, which is the LOCAL one — so
// without this line `acorn --node <remote>` opens a remote node's broker connection and then sends
// every request to the machine's own node. It also makes `activeCacheId()` and the client below the
// same partition, which is what the watchers write into.
setActiveNode(opened.nodeId)
// A data root can already hold node.json before its first Node handshake (an agent fixture does).
// On that path the local fleet has no row yet. Selecting against it would clear the known node id
// and leave every query with no target even after the handshake fills the fleet.
if (!opened.starting) await selectActiveNode()

// One client and one persister per node, and this host reads the same pair every other host does
// (docs/caching.md § Renderer query cache). `clientFor` hands back both halves, so there is nothing to
// build here beyond driving them.
const { client, persistence } = clientFor(opened.nodeId)
const cacheLease = persistence.acquire()
// Await the shared public restore before this host draws its first shell.
await cacheLease.restored
bootMark('cache restored')

// The runtime both clients share: telemetry, the node event watchers, notices, client schedules and
// device config sync (client-core/host/clientRuntime.ts). Awaited, so the device config's theme is the
// palette the first frame draws in.
//
// Telemetry posts over the ordinary API client, which on this host is the platform seam installed
// above, so the terminal client needs no transport of its own, only a different `runtime` on the
// batch (docs/tui/reporting.md § What the terminal client reports).
//
// Loaded plugin bundles wait for the worker factory, which loads after the first frame with the rest
// of the plugin work (`fillIn` below).
let pluginWorkersInstalled!: () => void
const pluginsReady = new Promise<void>((resolve) => {
  pluginWorkersInstalled = resolve
})
const stopClientRuntime = await startClientRuntime({
  runtime: 'tui',
  app: 'terminal',
  client: () => client,
  onDeviceConfig: (config) => {
    // A terminal has no OS light/dark signal. In follow-system mode, use the configured light pick.
    // Without a selected theme, retain the terminal's own palette.
    const id = config.themeFollowSystem ? config.themeLight : config.theme
    setPalette(paletteFor(id ? (themeColorTokens(id) ?? {}) : {}, reportsTruecolor()))
  },
  pluginsReady,
})

// The shell, and not one line earlier: a module that reaches the node must not be evaluated before
// `installPlatform` has run, or `send` finds no transport and falls back to global `fetch` with a
// relative path. The suite's harness imports it the same way (./harness.tsx).
//
// The roster is not in here: its plugin barrels and their `init` and `activate` passes load after the
// first frame (./roster.ts, ../scripts/check-startup-graph.mjs).
const { App } = await import('./App')
bootMark('App imported')

// The renderer is built here rather than left to `render`, because the keymap's terminal adapter
// binds to it and `render` hands it back to nobody.
//
// Ctrl+C at the shell is the TUI's, and inside an entered PTY rectangle it is the PTY's, which is the
// whole reason a rectangle owns its keys (docs/tui/process.md § Signals and exit). The terminal half
// handles `SIGWINCH` itself, so nothing here listens for a resize.
//
// The surface is two halves composed. The terminal owns the modes and the bytes, the screen owns the
// cells, and the screen closes first on the way out so the last frame lands while the alternate
// screen is still ours (./input/terminal.ts § The two halves compose, ./renderer.ts).
//
// The kitty keyboard protocol is asked for there and not assumed: a terminal that does not know the
// request ignores it, and the mode is popped on exit either way. Not a nicety — Ctrl+Return is the
// `commit` intent on this host, send this comment, send this message, and a legacy terminal sends the
// same single byte for Return with Ctrl and Return without it, so the chord does not exist to be
// bound. Disambiguation is the one flag that fixes it, and it fixes the same ambiguity for a lone
// Escape, which the parser otherwise has to wait out
// (docs/tui/keys.md § The adapter, ./kit/asking/composition.tsx § Composer).
//
// Nothing here focuses anything. Focus is the region store's and the surface has no second opinion
// about it: a click is a hit test into the store (./keys/regions.ts § Clicks are hit tests).
const renderer: Renderer = openTerminalRenderer()

// Every console call from here until the terminal is handed back, held rather than written. A
// library's `console.warn` goes to stderr, which is this terminal, so one line scrolls the screen and
// the shell reads as garbage until the next full repaint — and the two places that warn most are
// client-core's plugin roster and the agents plugin priming its sessions, both of which fire while a
// node this run started is still booting. So the one moment there is a shell to shred is the one
// moment something is shredding it.
//
// Held, not dropped: the lines go out with the boot account once `renderer.destroy()` has the terminal
// back, the same way Node's own warnings and a started node's stderr already do (./boot.ts § holdLine).
//
// The logger is held by this too, and that is the arrangement rather than an accident. A line written
// through `createLogger` still reaches the emitter and still becomes a record; what the hold catches
// is the `console.error` the logger writes underneath, which is the half that would draw on the
// screen (docs/telemetry/logging.md § Logging, docs/tui/reporting.md § What the terminal client reports).
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const
const realConsole = new Map(CONSOLE_METHODS.map((name) => [name, console[name].bind(console)]))
const releaseConsole = (): void => {
  for (const name of CONSOLE_METHODS) console[name] = realConsole.get(name)!
}
for (const name of CONSOLE_METHODS) console[name] = holdLine
bootMark('renderer created')
// Time to first draw: the renderer's own first `frame` event, which is the moment the first cells
// reached the terminal with nothing drawn over them.
renderer.once('frame', () => {
  bootMark('first draw')
  void fillIn()
})

// Everything the shell does not need in order to draw, run once the first frame is on screen.
//
// The roster is the big one and it is safe here because every contribution registry is a Solid signal:
// the chrome draws, this lands, and the rail, the pane strip and the palette fill from the same
// reactivity that already handles a loaded plugin arriving from a node seconds later (./roster.ts).
// The agents plugin's `activate` fires an HTTP request to prime its session store as it goes, which is
// the one thing in the pass that touches the node at all.
async function fillIn(): Promise<void> {
  const [{ installRoster }, { installPluginWorkers }] = await Promise.all([
    import('./roster'),
    import('./plugins/workerFactory'),
  ])
  // Loaded bundles are first discovered by the shared runtime's plugin watcher, which waits for this.
  // Their Node worker factory is installed here rather than in the graph needed to draw empty chrome.
  installPluginWorkers()
  installRoster()
  bootMark('roster registered')
  const [{ TrustPrompt }, { setTrustPromptComponent }] = await Promise.all([
    import('./plugins/TrustPrompt'),
    import('./plugins/trustPromptLoader'),
  ])
  setTrustPromptComponent(() => TrustPrompt)
  // Device installation pulls custody and source resolution into its command handlers. Register it
  // after the first frame with the rest of the plugin work, not in Shell's eager chrome graph.
  const { registerDevicePluginCommands } = await import('./plugins/commands')
  stopDeviceCommands = registerDevicePluginCommands().dispose

  pluginWorkersInstalled()

  // The node's arrival, which is behind the first frame. Everything the shell asked for while a
  // node it had just spawned was booting came back as `ECONNREFUSED`, and the first non-offline state
  // is when those are worth asking again. The desktop's composition root holds the same effect for the
  // same reason (apps/desktop/src/client/index.tsx).
  createRoot(() => {
    const refresh = latestSignal()
    createEffect(() => {
      const current = refresh.next()
      if (nodeState(opened.nodeId) === 'offline') return
      void refreshNodeQueries(client).then(() => {
        if (!current.aborted && nodeState(opened.nodeId) === 'online') markNodeRecovered(opened.nodeId)
      })
    })
  })

  if (link) {
    // Core places need the compiled roster, which is already installed above. Plugin paths and
    // sources need the selected Node's loaded contributions too. A stalled roster read must not
    // keep the terminal on its remembered place forever; after the deadline, the resolver gives a
    // specific unavailable-view refusal if the contribution still has not arrived.
    if (
      (link.kind === 'task' && !link.pane) ||
      (link.kind === 'settings' && !link.pageId) ||
      (link.kind === 'project' && !link.rest.length)
    ) {
      setLinkReady(true)
    } else {
      const { preparePluginContributionsForNode } = await import('@acorn/client-core/host/plugins/reload.ts')
      let deadline: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        (async () => {
          if (opened.starting) await opened.starting.catch(() => undefined)
          await preparePluginContributionsForNode(opened.nodeId)
        })().catch((error: unknown) => log.warn('could not load linked node plugin contributions', error)),
        new Promise<void>((resolve) => {
          deadline = setTimeout(resolve, 15_000)
        }),
      ])
      if (deadline) clearTimeout(deadline)
      setLinkReady(true)
    }
  }

  // The sound channel: an unseen agent edge rings the terminal.
  const { initBellNotices } = await import('./kit/bell')
  initBellNotices()
}
// Node's own warnings never pass through that console. `process.emitWarning` writes to stderr, which
// is the file the renderer draws on, so one arriving mid-session leaves the shell reading as garbage
// until the next full repaint. Held while the renderer owns the terminal and printed once it hands it
// back, so nothing is lost and nothing is drawn over. A `Set` because Node repeats a warning per
// emitter, and the same line held fifty times says nothing the first one did not.
const heldWarnings = new Set<string>()
process.removeAllListeners('warning')
process.on('warning', (warning) => {
  heldWarnings.add(`${warning.name}: ${warning.message}`)
})
// Whether this terminal is the one the reader is looking at, which is the gate's `focused()` and
// therefore the difference between a notice that lands read and one that raises a banner. Client
// schedules read it too, to slow a backstop clock. The renderer asks for DEC 1004 focus reports and
// turns `ESC [ I` and `ESC [ O` into these two events.
//
// A plain variable rather than a signal: the gate reads it imperatively a second after an edge, and
// nothing draws from it. It starts true because unknown counts as focused — a terminal that never
// answers must not be treated as one nobody is watching (client-core § hostFocused).
let terminalFocused = true
renderer.on('focus', () => {
  terminalFocused = true
})
renderer.on('blur', () => {
  terminalFocused = false
})
setHostFocused(() => terminalFocused)

const engine = installKeymap(renderer)

// The terminal comes back first, then the node drains. A node that started here gets its bounded
// SIGTERM drain; one this TUI only attached to is left running, because whoever started it owns it.
let stopDeviceCommands: (() => void) | undefined
async function quit(code = 0): Promise<never> {
  stopDeviceCommands?.()
  stopClientRuntime()
  if (leaving) return await new Promise<never>(() => {}) // a second Ctrl+C during the drain waits
  leaving = true
  renderer.destroy()
  releaseConsole()
  // The terminal is ours again, so everything held while the screen was busy can go out: the boot
  // account, then a started node's own stderr, then whatever this file and every console call wanted
  // to say, then Node's warnings. Through the real `console.error` captured at install time rather
  // than through the logger, because a held console would file these back into the list it is
  // reading, and because a boot account is not a log line.
  const write = realConsole.get('error')!
  printBootMarks(write)
  for (const line of opened.held ?? []) write(`[node] ${line}`)
  for (const line of heldLines()) write(line)
  for (const warning of heldWarnings) write(warning)
  cacheLease.release()
  await persistence.flush().catch((error: unknown) => log.warn('could not flush query cache', error))
  await platform.dispose()
  process.exit(code)
}

// `q` is the shell's, registered as a command with a confirm when this TUI is the thing that started
// the node (./chrome/Shell.tsx). `Ctrl+C` is not: it is the signal a terminal sends to say stop now,
// and it stops now. Inside an entered rectangle it never reaches here at all, which is the whole
// point of the Rectangle contract.
engine.registerLayer({
  priority: COMMAND,
  bindings: [
    {
      key: 'ctrl+c',
      cmd: () => {
        void quit()
        return true
      },
    },
  ],
})
// A supervisor's SIGTERM drains the child this process started, which is the whole reason it waits.
process.once('SIGTERM', () => void quit())

// A node this run started has not answered anything yet, and the footer says so until it does. Set
// before the first frame, so nothing draws the wrong thing even once — and after `quit`, because a
// child that fails to spawn rejects on the next tick and quitting needs a renderer to hand back
// (./chrome/nodeState.ts).
if (opened.starting) {
  setNodeStarting(true)
  void opened.starting
    .then(async () => {
      await selectActiveNode()
      await refreshNodeQueries(client)
      setNodeStarting(false)
    })
    .catch((error: unknown) => {
      setNodeStarting(false)
      log.error(`acorn could not start a node: ${error instanceof Error ? error.message : String(error)}`)
      void quit(1)
    })
}

// The tree mounts on the screen's root node rather than on the surface around it
// (./tree/renderer.ts § render).
const target = renderer.root

await render(
  () => (
    <App
      client={client}
      nodeId={opened.nodeId}
      supervised={opened.supervised}
      {...(values.task ? { task: values.task } : {})}
      {...(link ? { link, linkReady } : {})}
      onNoTask={(id) => {
        log.warn(`No task ${id} on this node.`)
        // Not from here. A warm cache answers the tasks query on the first tick, so this callback can
        // fire inside `render()` — and `renderer.destroy()` from inside a render pass throws, which
        // takes the exit path with it and prints nothing at all. Let the frame finish, then leave.
        setTimeout(() => void quit(1))
      }}
      onQuit={() => void quit()}
    />
  ),
  target as never,
)
