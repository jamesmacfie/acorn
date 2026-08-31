/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { BoxRenderable, KeyEvent, Renderable } from '@opentui/core'
import { prefsOptions } from '@acorn/client-core/infra/queries.ts'
import { PrefKeys } from '@acorn/client-core/infra/persistence/prefKeys.ts'
import { keymap } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { activeTaskId, selectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { registerCommands } from '@acorn/client-core/host/registries/commands/commands.ts'
import { registerKeybindings } from '@acorn/client-core/host/registries/commands/keybindings.ts'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources/sources.ts'
import { activeNodeId, setActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
import { nodes } from '@acorn/client-core/infra/node/fleet.ts'
import { Dynamic } from '@opentui/solid'
import { Line, Rule } from '../kit/cells'
import { EmptyState, Row, Rows } from '../kit/showing'
import { Modal, ModalBody } from '../kit/grouping'
import { installCommandLayer } from '../keys/commandLayer'
import { bindKeys } from '../keys/install'
import { focusedRenderable, regionFocus, setPaneCycler, takeFocus } from '../keys/regions'
import { startSpinner } from '../kit/tick'
import { createShellModel } from './model'
import { closeOverlay, openOverlay, setWorkspaceMenu, topOverlay } from './state'
import { cyclePane } from './panes'
import { Rail, RAIL_COLLAPSE_AT } from './Rail'
import { Topbar } from './Topbar'
import { PaneBody, PaneStrip } from './PaneRow'
import { Footer } from './Footer'
import { Notifications, dismissNotifications } from './Notifications'
import { Palette } from './Palette'
import { CheatSheet } from './CheatSheet'

// The arrangement: topbar, rail beside the pane, notifications, footer, and whatever overlay is on
// top of it all.
//
// The desktop's equivalent is `apps/desktop/src/client/App.tsx`, and its own header says why it lives
// in the app rather than in client-core: it is the arrangement, not the parts. Same here. Nothing in
// this file is a component another host could use; everything in it is a decision about where things
// go on one screen.
//
// The regions are ordered around the pane rather than inside it. A layout registers its regions at 0,
// 1, 2 from its own knowledge, so the chrome takes numbers outside that range and the cycle reads
// down the screen: rail, pane strip, the pane's own regions. The footer is not in it — it is a label,
// and a stop that does nothing is a hole a reader falls into (../keys/regions.ts § moveRegion).
const STRIP_ORDER = -50

export function Shell(props: { nodeId: string; supervised: boolean; onQuit: () => void }) {
  const model = createShellModel()
  const prefs = createQuery(() => prefsOptions(true))
  let root: BoxRenderable | undefined
  const [strip, setStrip] = createSignal<BoxRenderable | undefined>()
  const [width, setWidth] = createSignal(RAIL_COLLAPSE_AT)
  const [hidden, setHidden] = createSignal(false)
  // Two ways to lose the rail and they are not the same: a reader asked, or there is no room. The
  // desktop's `leftCollapsed` preference is the first; the second is this host's own, because a
  // terminal can be 80 cells wide and 18 of them is a fifth of the screen.
  const collapsed = () => hidden() || width() < RAIL_COLLAPSE_AT

  const source = () => sourceRegistry.get(selectedSource() ?? '')

  // Open on something. The desktop restores `last_task` from a preference; this host persists nothing
  // across runs, so the first task is the friendly default and the alternative is an empty screen.
  createEffect(() => {
    if (activeTaskId() || selectedSource()) return
    const first = model.tasks()[0]
    if (first) activateTaskSignals(first)
  })

  // The pane chords, answered by the shell because this host draws one pane and "the next pane" is a
  // switch rather than a walk (./panes.ts).
  setPaneCycler((delta) => cyclePane(model.task(), delta))
  onCleanup(() => setPaneCycler(null))

  // One tick for every spinner on screen (../kit/tick.ts).
  onMount(() => onCleanup(startSpinner()))

  // The command layer, tier 0: every keybinding the app and its plugins registered, over the command
  // registry, with the reader's own overrides applied. The scope questions are the shell's signals.
  onMount(() => {
    const engine = keymap<Renderable, KeyEvent>()
    if (engine) {
      installCommandLayer(engine, {
        prefs: () => ({
          ...(prefs.data?.[PrefKeys.keybindings] ? { keybindings: prefs.data[PrefKeys.keybindings] } : {}),
          ...(prefs.data?.[PrefKeys.paneShortcuts] ? { pane_shortcuts: prefs.data[PrefKeys.paneShortcuts] } : {}),
        }),
        taskActive: () => !!model.task(),
        // Always undefined, so a `pane`-scoped binding never fires here. The scope means "the keys are
        // in this pane and no other", and this host draws one pane at a time; a binding scoped to the
        // pane on screen would be a binding scoped to everything. Phase 6 revisits it if a pane in the
        // sweep turns out to want one.
        focusedPane: () => undefined,
      })
    }
  })

  // The shell's own commands. Registered rather than written into a key handler, so each one is also
  // a palette row and each chord is one the reader can rebind, which is what every other command in
  // the app already is (docs/command-palette-and-shortcuts.md).
  onMount(() => {
    const quit = () => {
      // A node this TUI started dies with it, and a reader who typed `q` by accident should not
      // discover that afterwards. One this TUI only attached to is left running, so there is nothing
      // to confirm (docs/future/terminal/03-process-model.md § Attach or start).
      if (props.supervised) openOverlay('quit')
      else props.onQuit()
    }
    const commands = registerCommands([
      { id: 'core.palette.open', title: 'Commands', category: 'navigation', run: () => openOverlay('palette') },
      { id: 'core.shortcuts.cheat-sheet', title: 'Help', hint: 'what the keyboard does right here', category: 'navigation', palette: true, run: () => openOverlay('help') },
      { id: 'core.workspace.switch', title: 'Switch workspace', category: 'workspace', palette: true, run: () => { setWorkspaceMenu(true) } },
      { id: 'core.rail.toggle', title: 'Rail', category: 'navigation', palette: true, run: () => { setHidden((value) => !value) } },
      { id: 'core.quit', title: 'Quit', category: 'action', palette: true, run: quit },
    ])
    // Ctrl and not `meta`, which is acorn's spelling for the platform command key: a terminal
    // emulator keeps Cmd for itself and never delivers it, so a `meta` chord here would be one
    // nobody can press. Same reason the intent table is installed at Ctrl (../keys/install.ts).
    const bindings = registerKeybindings([
      { id: 'core.palette.open', command: 'core.palette.open', description: 'Commands', category: 'Global', defaultChord: 'ctrl+k', when: 'global' },
      { id: 'core.shortcuts.cheat-sheet', command: 'core.shortcuts.cheat-sheet', description: 'Help', category: 'Global', defaultChord: '?', when: 'global' },
      { id: 'core.workspace.switch', command: 'core.workspace.switch', description: 'Workspace', category: 'Global', defaultChord: 'w', when: 'global' },
      { id: 'core.rail.toggle', command: 'core.rail.toggle', description: 'Rail', category: 'Global', defaultChord: 'ctrl+b', when: 'global' },
      { id: 'core.quit', command: 'core.quit', description: 'Quit', category: 'Global', defaultChord: 'q', when: 'global' },
    ])
    onCleanup(() => { bindings.dispose(); commands.dispose() })
  })

  // One command per node this device has paired with, so switching node is a palette row rather than
  // a control nothing else needs. Re-registered when the fleet changes, which is what pairing does.
  createEffect(() => {
    const others = nodes().filter((node) => node.nodeId !== activeNodeId())
    if (!others.length) return
    const commands = registerCommands(others.map((node) => ({
      id: `core.node.select.${node.nodeId}`,
      title: `Switch to node: ${node.label}`,
      category: 'navigation' as const,
      palette: true,
      run: () => setActiveNode(node.nodeId),
    })))
    onCleanup(() => commands.dispose())
  })

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      ref={(element: BoxRenderable) => {
        root = element
        setWidth(element.width)
        // Escape with nothing open clears what is on screen. Layer 5, so a collection or a rectangle
        // that has something of its own to dismiss answers first.
        bindKeys(element, [{ key: 'escape', cmd: () => dismissNotifications() }], 5)
      }}
      onSizeChange={() => setWidth(root?.width ?? RAIL_COLLAPSE_AT)}
    >
      <Topbar model={model} nodeId={props.nodeId} />
      <box flexDirection="row" flexGrow={1}>
        <Rail model={model} collapsed={collapsed()} />
        <Rule axis="y" />
        <box flexDirection="column" flexGrow={1}>
          {/* Hidden, not unmounted: opening the palette must not tear down the pane behind it and
              throw away its queries and its model. `visible` is what a cell host has instead of a
              floating layer, and it is the same thing `TabPanel` does for a hidden tab. */}
          <box flexDirection="column" flexGrow={1} visible={!topOverlay()}>
            <box
              flexShrink={0}
              flexDirection="column"
              ref={(element: BoxRenderable) => {
                setStrip(element)
                regionFocus({ paneId: 'chrome', regionId: 'panes' }, STRIP_ORDER)(element)
                element.focusable = true
                // The strip is a region you can be in, so it answers the list intents while you are:
                // `j`/`k` walk the panes rather than the chord alone, because a chord nobody
                // discovers is a chord nobody uses.
                bindKeys(element, [
                  { key: 'j', cmd: () => cyclePane(model.task(), 1) },
                  { key: 'k', cmd: () => cyclePane(model.task(), -1) },
                  { key: 'down', cmd: () => cyclePane(model.task(), 1) },
                  { key: 'up', cmd: () => cyclePane(model.task(), -1) },
                ], 40)
              }}
            >
              <Show when={model.task()}>
                {(task) => <PaneStrip task={task()} focused={!!strip() && focusedRenderable() === strip()} />}
              </Show>
            </box>
            <Switch fallback={<EmptyState title="Nothing open">Choose a task in the rail.</EmptyState>}>
              <Match when={source()?.component}>{(component) => <Dynamic component={component()} />}</Match>
              <Match when={model.task()}>{(task) => <PaneBody task={task()} />}</Match>
            </Switch>
          </box>
          <Show when={topOverlay()}>
            {(name) => (
              <Switch>
                <Match when={name() === 'palette'}><Palette model={model} /></Match>
                <Match when={name() === 'help'}><CheatSheet /></Match>
                <Match when={name() === 'quit'}><QuitConfirm onQuit={props.onQuit} /></Match>
              </Switch>
            )}
          </Show>
        </box>
      </box>
      <Notifications />
      <Footer nodeId={props.nodeId} />
    </box>
  )
}

/** The two-way question, as a list, because a terminal `Button` is a run of text and not a stop: the
 *  only thing here a reader can drive is a collection, so the choice is one. */
function QuitConfirm(props: { onQuit: () => void }) {
  const close = () => closeOverlay('quit')
  return (
    <Modal onDismiss={close} title="Quit" size="sm">
      <ModalBody>
        <box flexDirection="column" ref={(element: BoxRenderable) => takeFocus(element)}>
          <Line role="muted">acorn started this node, so quitting stops it.</Line>
          <Rows
            id="chrome.quit"
            ariaLabel="Quit"
            items={[{ key: 'quit', label: 'Quit and stop the node' }, { key: 'stay', label: 'Stay' }]}
            onActivate={(key) => (key === 'quit' ? props.onQuit() : close())}
          >
            {(row, item) => <Row item={item}>{row.label}</Row>}
          </Rows>
        </box>
      </ModalBody>
    </Modal>
  )
}
