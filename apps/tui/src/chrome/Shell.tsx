/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, Match, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js'
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
import { pendingTrust } from '@acorn/client-core/host/plugins/distribution.ts'
import { Dynamic } from '@opentui/solid'
import { Line } from '../kit/cells'
import { EmptyState, Row, Rows } from '../kit/showing'
import { Modal, ModalBody } from '../kit/grouping'
import { PanelBody } from '../panel'
import { installCommandLayer } from '../keys/commandLayer'
import { bindKeys } from '../keys/install'
import { focusedRenderable, regionFocus, setPaneCycler, takeFocus } from '../keys/regions'
import { startSpinner } from '../kit/tick'
import { createShellModel, type ShellModel } from './model'
import { chooseProject, installRouting, routedProjectId } from './routing'
import { closeOverlay, openOverlay, topOverlay } from './state'
import { cyclePane } from './panes'
import { Rail, railCells } from './Rail'
import { Topbar } from './Topbar'
import { PaneBody, PaneStrip } from './PaneRow'
import { Footer } from './Footer'
import { Notifications, dismissNotifications } from './Notifications'
import { TrustPrompt } from '../plugins/TrustPrompt'
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
  // The shell's own width, so the left column can take a share of it rather than a fixed number of
  // cells (./Rail.tsx § railCells). The one width anything in the chrome reads, and it is this box's
  // rather than the terminal's — the same rule a layout keeps (docs/tui.md § What the TUI never does).
  const [cells, setCells] = createSignal(80)
  // One way to lose the left column: a reader asked, on `ctrl+b`, which is the desktop's
  // `leftCollapsed` preference at a chord. There used to be a second — collapsing to a two-cell strip
  // of marks below 100 columns — and it went with the icons: the strip only ever said anything
  // because each row had a glyph in it, and most of those glyphs drew nothing (../kit/glyphs.ts).
  const [hidden, setHidden] = createSignal(false)

  const source = () => sourceRegistry.get(selectedSource() ?? '')

  // What the path says, read into the shell: which task to open, which source claims it, and which
  // project every project-scoped browse surface reads (./routing.ts).
  installRouting(model)

  // Open on something. The desktop restores `last_task` from a preference; this host persists nothing
  // across runs, so the first task is the friendly default and the alternative is an empty screen.
  createEffect(() => {
    if (activeTaskId() || selectedSource()) return
    const first = model.tasks()[0]
    if (first) activateTaskSignals(first)
  })

  // A bundle this device has never decided about. Raised rather than opened by a key, because nobody
  // asked for it: the distribution pass found code a node is offering and nothing runs until the
  // reader answers (../plugins/TrustPrompt.tsx). Escape drops the queue entry, which is what closes
  // this again.
  createEffect(() => {
    if (pendingTrust().length) openOverlay('trust')
    else closeOverlay('trust')
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
      // to confirm (docs/tui.md § Attach or start).
      if (props.supervised) openOverlay('quit')
      else props.onQuit()
    }
    const commands = registerCommands([
      { id: 'core.palette.open', title: 'Commands', category: 'navigation', run: () => openOverlay('palette') },
      { id: 'core.shortcuts.cheat-sheet', title: 'Help', hint: 'what the keyboard does right here', category: 'navigation', palette: true, run: () => openOverlay('help') },
      { id: 'core.workspace.switch', title: 'Switch workspace', category: 'workspace', palette: true, run: () => openOverlay('workspace') },
      { id: 'core.project.switch', title: 'Switch project', category: 'workspace', palette: true, run: () => openOverlay('project') },
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
      { id: 'core.project.switch', command: 'core.project.switch', description: 'Project', category: 'Global', defaultChord: 'p', when: 'global' },
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
        setCells(element.width)
        // Escape with nothing open clears what is on screen. Layer 5, so a collection or a rectangle
        // that has something of its own to dismiss answers first.
        bindKeys(element, [{ key: 'escape', cmd: () => dismissNotifications() }], 5)
      }}
      onSizeChange={() => setCells(root?.width ?? 80)}
    >
      <Topbar model={model} nodeId={props.nodeId} />
      <box flexDirection="row" flexGrow={1}>
        {/* No rule between the column and the pane: each panel draws its own frame, and a rule beside
            a border is two lines saying one thing (../panel.tsx). */}
        <Show when={!hidden()}><Rail model={model} cells={railCells(cells())} /></Show>
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
            {/* Under `PanelBody`, because a browse source's component is a `lazy()` and a pending one
                resolves to an empty string — which a cell host refuses outright, where the DOM would
                have shrugged and drawn a text node nobody sees. The same guard the pane mount path
                already has for the same reason (../layouts/index.ts, findings.md § A pending `lazy()`
                region is an empty string). It carries the error boundary too, so a surface that
                throws says what it threw rather than leaving the main panel blank (../panel.tsx). */}
            <PanelBody>
              <Switch fallback={<EmptyState title="Nothing open">Choose a task in the rail.</EmptyState>}>
                {/* A source that declared regions has its list in the Browse panel already, so the
                    main panel is its detail alone. One that did not keeps its whole surface here,
                    which is every source that has not been migrated
                    (client-core/host/registries/sources/sources.ts § regions). */}
                <Match when={source()?.regions?.detail}>{(detail) => <SourceRegion><Dynamic component={detail()} /></SourceRegion>}</Match>
                <Match when={source()?.component}>{(component) => <SourceRegion><Dynamic component={component()} /></SourceRegion>}</Match>
                <Match when={model.task()}>{(task) => <PaneBody task={task()} />}</Match>
              </Switch>
            </PanelBody>
          </box>
          <Show when={topOverlay()}>
            {(name) => (
              <Switch>
                <Match when={name() === 'palette'}><Palette model={model} /></Match>
                <Match when={name() === 'help'}><CheatSheet /></Match>
                <Match when={name() === 'workspace'}><WorkspacePicker model={model} /></Match>
                <Match when={name() === 'project'}><ProjectPicker model={model} /></Match>
                <Match when={name() === 'quit'}><QuitConfirm onQuit={props.onQuit} /></Match>
                <Match when={name() === 'trust'}><TrustPrompt /></Match>
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

/** A browse surface in the main panel, as a region the keys can be in.
 *
 *  A pane registers its regions from its layout, and a browse source has no layout — so the main
 *  panel was the one place on this screen Tab could not reach. Everything in it was unreachable with
 *  it: the diff had no way to scroll and a `Sections` strip had no way to hear `h`
 *  (../kit/grouping.tsx). Order 0, which is where a layout's first region sits, so the cycle still
 *  reads down the screen: Menu, Browse, Tasks, then this.
 */
function SourceRegion(props: { children: JSX.Element }) {
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      minWidth={0}
      ref={regionFocus({ paneId: 'chrome', regionId: 'source' }, 0)}
    >
      {props.children}
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

/** The project picker. `p` where `w` is the workspace, and an overlay for the same reason: the whole
 *  screen changes when a row is chosen, and a list drawn under the topbar left the keys wherever they
 *  already were.
 *
 *  Choosing writes a path rather than a signal. Every project-scoped surface reads `params.projectId`
 *  — that is what makes the GitHub browse list know which repository it is listing — so there has to
 *  be exactly one place the answer lives, and it is the path (./routing.ts). */
function ProjectPicker(props: { model: ShellModel }) {
  const close = () => closeOverlay('project')
  const projects = () => props.model.workspace()?.projects ?? []
  return (
    <Modal onDismiss={close} title="Project" size="sm">
      <ModalBody>
        <box flexDirection="column" ref={(element: BoxRenderable) => takeFocus(element)}>
          <Show when={projects().length} fallback={<Line role="muted">This workspace has no projects.</Line>}>
            <Rows
              id="chrome.projects"
              ariaLabel="Projects"
              items={projects().map((project) => ({ key: project.id, ...project }))}
              onActivate={(id) => { chooseProject(id); close() }}
            >
              {(project, item) => (
                <Row item={item} selected={project.id === routedProjectId()}>{project.name}</Row>
              )}
            </Rows>
          </Show>
        </box>
      </ModalBody>
    </Modal>
  )
}

/** The workspace picker, as an overlay rather than a list under the topbar: it is the shell's chord
 *  that opens it, the whole screen changes when a row is chosen, and a list drawn under the topbar
 *  left the keys wherever they already were — so the reader saw a list they could not drive. An
 *  overlay is the shape that takes the keys and gives them back (./state.ts, ../keys/regions.ts). */
function WorkspacePicker(props: { model: ShellModel }) {
  const close = () => closeOverlay('workspace')
  return (
    <Modal onDismiss={close} title="Workspace" size="sm">
      <ModalBody>
        <box flexDirection="column" ref={(element: BoxRenderable) => takeFocus(element)}>
          <Rows
            id="chrome.workspaces"
            ariaLabel="Workspaces"
            items={props.model.workspaces().map((workspace) => ({ key: workspace.id, ...workspace }))}
            onActivate={(id) => { props.model.chooseWorkspace(id); close() }}
          >
            {(workspace, item) => (
              <Row item={item} selected={workspace.id === props.model.workspace()?.id}>{workspace.name}</Row>
            )}
          </Rows>
        </box>
      </ModalBody>
    </Modal>
  )
}
