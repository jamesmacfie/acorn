/** @jsxImportSource @acorn/tui/jsx */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  untrack,
  type Component,
  type JSX,
} from 'solid-js'
import { Dynamic } from '../tree/renderer'
import type { PluginExtensionItem } from '@acorn/protocol/extensionPoints.ts'
import type { Task } from '@acorn/client-core/infra/queries.ts'
import type { PromoteTaskAction } from '@acorn/client-core/features/integrations'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { createFleetQuery } from '@acorn/client-core/infra/node'
import {
  extensionDeliveries,
  extensionPointRegistry,
  type ExtensionContribution,
} from '@acorn/client-core/host/registries/extensionPoints/extensionPoints.ts'
import { chromeDeps, chromeKey } from '@acorn/client-core/host/chrome'
import {
  compiledOwnerHost,
  createSlotChoice,
  GESTURE_WINDOW_MS,
  resolveSlot,
  type OwnerActions,
} from '@acorn/client-core/host/tree'
import { contextMenuItems, runContextMenuItem, selectionTooLarge } from '@acorn/client-core/host/registries/panes'
import type { SelectionActionsProps } from '@acorn/client-core/host/registries/panes/SelectionActions.tsx'
import { RemoteTree } from '../plugins/remoteTreeLoader'
import type { Renderable } from '../tree/compat'
import { pressedWithin } from '../keys/stops'
import { CORE_MARKDOWN_FENCE_POINT } from '@acorn/protocol/extensionPoints.ts'
import type { MarkdownFenceAdapter } from '@acorn/client-core/kit/lib/markdown'
import {
  createFenceViewers,
  type FenceScope,
  type FenceViewer,
} from '@acorn/client-core/host/markdownFences/fenceViewers.ts'
import { htmlLines } from './markdown'
import { Line } from './cells'
import { Badge, Icon, Lines, Row, Rows } from './showing'
import { Button, CopyButton, IconButton } from './asking'
import { Menu, Modal, ModalBody, SectionHeader } from './grouping'

// What `@acorn/plugin-api/ui/host` is on this host.
//
// The sibling of ./ui.ts one rung up. That barrel is the kit, which every pane draws with; this one
// is the *host's* own surfaces — the palette chrome, the drawer, the reference-panel box, the two
// cooperative-extension nodes — and the DOM's copies of them are backdrops, portals and `<ul>`s. A
// pane imports the same names on both hosts and a different component answers each, which is the
// same switch ./ui.ts makes and the reason a pane's source is unchanged here.

// ── Host machinery, unchanged ─────────────────────────────────────────────────────────────────────
// Registries and pure rules. None of these draw, so both hosts spend the same module.
// The shell's one confirmation, drawn by the shell over whatever has the screen (../chrome/Confirmation.tsx).
export { confirmAction } from '../chrome/confirmStore'
export { requestAnnotations, annotationsFor } from '@acorn/client-core/host/annotations/annotations.ts'
// The `wizard` layout for a surface that is a wizard and is not a pane. The same component the layout
// table hands the pane registry, so onboarding's overlay and a `wizard` pane are arranged alike.
export { Wizard } from '../layouts/Wizard'

// The compiled message composer uses the terminal projection of the host's model-choice control.
export { ModelPickerPopover } from './asking/modelPickerPopover'
export { IconPicker } from './asking/iconPicker'

// ── The acorn ────────────────────────────────────────────────────────────────────────────────────

const ART = [' ()', ".-''-.", '/::::::\\', "'------'", '|      |', ' \\    /', '  \\  /', '   \\/']

/** The splash. Already ASCII on the desktop, which is the one kit-shaped thing on this barrel and the
 *  reason it crosses without losing anything. */
export function Acorn(props: { label?: string }) {
  return (
    <box flexDirection="column" alignItems="center">
      <For each={ART}>{(row) => <Line role="muted">{row}</Line>}</For>
      <Line role="strong">{props.label ?? 'acorn'}</Line>
    </box>
  )
}

// ── Overlays and boxes ───────────────────────────────────────────────────────────────────────────

/** The bottom dock, as a box.
 *
 *  A drawer is a place on the desktop's screen: between the two icon rails, above the task footer, at
 *  a height a grip dragged it to. None of those exist here — this host draws one pane, the drawer's
 *  sources are rows in the rail, and choosing one opens the PTY where the pane goes
 *  (docs/tui/chrome.md § What is drawn bespoke). So the box stays and the geography
 *  goes, and `height` is ignored because a pixel count is not a thing a cell host can spend. */
export function Drawer(props: {
  height: number
  maximized?: boolean
  ariaLabel: string
  ref?: (element: HTMLElement) => void
  children: JSX.Element
}) {
  return (
    <box flexDirection="column" flexGrow={1}>
      {props.children}
    </box>
  )
}

/** The box a reference panel is drawn in. A drawer over half the window on the desktop; a modal where
 *  the pane goes here, for the reason every other overlay flattens (../kit/grouping.tsx). */
export default function RefPanelBoxDefault(props: {
  title: string
  onClose: () => void
  children: JSX.Element
  footer?: JSX.Element
}) {
  return (
    <Modal onDismiss={props.onClose} title={props.title} size="lg">
      <ModalBody>{props.children}</ModalBody>
      {props.footer}
    </Modal>
  )
}
export { RefPanelBoxDefault as RefPanelBox }

/** Promote a row to a task, with the optional workflow step above it.
 *
 *  Absent, and it says so. The surface that opens it is a row menu on a descriptor source's list, and
 *  this host's source panel draws no row menu
 *  (../plugins/SourcePanel.tsx, docs/tui/plugin-losses.md § What a plugin loses here). Nothing here
 *  mounts an `overlay` slot either, so this stands in for a build, not for a screen. */
export function PromoteToTaskModal(_props: {
  providerId: string
  item: unknown
  itemTitle: string
  headerLabel: string
  attachTasks: Task[]
  existingBranches: string[]
  action?: PromoteTaskAction
  onClose: () => void
  onCreated: (task: Task) => void
  onAttached: (task: Task) => void
}) {
  return <Line role="muted">Making a task from this row is not drawn here.</Line>
}
/** The Config files section of the agents plugin's MCP page.
 *
 *  Absent, and it says so: core draws the list with the desktop's own controls. */
export function McpConfigFiles() {
  return (
    <Line role="muted">
      The servers each CLI loads from its own config files are listed in the Config files section in the desktop app.
    </Line>
  )
}

/** "Is there a task for this thing, and if not, start one".
 *
 *  Absent, and it says so. The DOM control is a `Select` of repos and a create button wired to the
 *  desktop's router. A reader who wants a task for this reference makes one in the rail, which is two keys
 *  away and does not need this line to be a lie. */
export function RefPanelTaskLink(_props: { target: unknown }) {
  return <Line role="muted">Start a task for this from the rail.</Line>
}

/** HTML a provider already rendered, in the host's own skin.
 *
 *  GitHub hands back `bodyHTML` rather than markdown source, so the kit's `Markdown` node has nothing
 *  to do with this content. The DOM writes the string into a div; here it goes through the same tag
 *  walk the markdown pass uses (./markdown.ts § htmlLines) and comes out as lines of runs.
 *
 *  The bare-reference pass and the click handler are both absent: the first rewrites text nodes in a
 *  written document, and the second needs a pointer. Links keep their URL beside them, which is what
 *  this host does with every link. */
export function ProviderHtml(props: {
  html: string
  refs?: ReadonlyMap<string, string>
  onLinkClick?: (event: MouseEvent) => void
  onText?: (text: string) => void
}) {
  const lines = createMemo(() => {
    const parsed = htmlLines(props.html)
    props.onText?.(parsed.map((line) => line.runs.map((run) => run.text).join('')).join('\n'))
    return parsed
  })
  return <Lines lines={lines()} />
}

// ── Cooperative extension points ─────────────────────────────────────────────────────────────────

type SlotProps = {
  point: string
  key?: string
  props?: () => unknown
  children?: JSX.Element
  taskId?: string
  projectId?: string | null
  /** What this owner will do if a contributor asks (docs/plugins/remote-points.md § Asking the owner). Host-only:
   *  neither the handlers nor their names are sent to the worker. */
  actions?: OwnerActions
  /** Whether a contributor is standing in for the owner's default right now, for an owner that has to
   *  keep drawing something a contributor must not be given. */
  occupied?: (occupied: boolean, pluginId?: string) => void
}

/**
 * A place in one plugin's tree where another plugin's tree may be grafted.
 *
 * The terminal's sibling of `client-core/host/tree/Slot.tsx`, and the same division of labour every
 * other one keeps: `arbitration.ts` decides who draws and is shared unchanged; only the drawing is
 * the host's. Two things differ, and both are the host switch rather than a rule: `Dynamic` comes
 * from `../tree/renderer.ts` rather than `solid-js/web`, because pulling the DOM renderer in for one
 * component would put a second Solid renderer in this process; and the overflow disclosure is a line
 * of muted text rather than a `<span class="muted">`.
 */
export function Slot(props: SlotProps) {
  const choice = createSlotChoice(
    () => props.point,
    () => props.key,
  )

  const resolved = createMemo(() => {
    const point = extensionPointRegistry.get(props.point)
    if (!point || point.kind !== 'remote') return null
    return {
      mode: point.mode ?? 'stack',
      actions: point.actions ?? [],
      outcome: resolveSlot(point, props.key, choice),
    }
  })
  const outcome = () => resolved()?.outcome
  // A failed tree draws nothing, so the owner's default stands in for it, as on the desktop.
  const [failed, setFailed] = createSignal<readonly string[]>([])
  const standing = () => outcome()?.occupants.find((entry) => !failed().includes(entry.id))
  const drawDefault = () => resolved()?.mode !== 'replace' || !standing()

  createEffect(() => props.occupied?.(!drawDefault(), drawDefault() ? undefined : standing()?.pluginId))

  return (
    <>
      <Show when={drawDefault()}>{props.children}</Show>
      <Show when={outcome()?.occupants.length}>
        <For each={outcome()!.occupants}>
          {(contribution) => (
            <Show
              when={contribution.carrier === 'component' && contribution.component}
              fallback={
                <RemoteTree
                  contribution={{
                    id: contribution.id,
                    pluginId: contribution.pluginId,
                    hash: contribution.hash ?? '',
                    entry: contribution.entry ?? '',
                    ...(contribution.overlay ? { overlay: contribution.overlay } : {}),
                  }}
                  props={props.props ?? (() => ({}))}
                  actions={() => props.actions ?? {}}
                  declaredActions={() => resolved()?.actions ?? []}
                  scope={() => ({
                    ...(props.taskId ? { taskId: props.taskId } : {}),
                    ...(props.projectId ? { projectId: props.projectId } : {}),
                  })}
                  onFailed={() => setFailed((ids) => [...ids, contribution.id])}
                />
              }
            >
              {(component) => (
                <Show
                  when={resolved()?.actions.length}
                  fallback={<Dynamic component={component()} {...(props.props?.() as Record<string, unknown>)} />}
                >
                  <CompiledWithHost
                    component={component()}
                    props={() => props.props?.() as Record<string, unknown>}
                    declared={() => resolved()?.actions ?? []}
                    actions={() => props.actions ?? {}}
                  />
                </Show>
              )}
            </Show>
          )}
        </For>
        <Show when={outcome()!.why === 'match' ? outcome()!.overflow : 0}>
          {(overflow) => <Line role="muted">{`${overflow()} more from other plugins`}</Line>}
        </Show>
      </Show>
    </>
  )
}

/** A compiled contributor at a point that declares owner actions: the same `host.invoke` and the same
 *  check a loaded tree gets, with a box that hears the person's presses inside it, as on the desktop
 *  (client-core host/tree/Slot.tsx § CompiledWithHost). */
function CompiledWithHost(props: {
  component: Component<Record<string, unknown>>
  props: () => Record<string, unknown> | undefined
  declared: () => readonly string[]
  actions: () => OwnerActions
}) {
  let container: Renderable | undefined
  const presses = pressedWithin(() => container, GESTURE_WINDOW_MS)
  onCleanup(presses.dispose)
  const host = compiledOwnerHost({ declared: props.declared, actions: props.actions, byPerson: presses.recent })
  return (
    <box
      flexShrink={0}
      ref={(element: Renderable) => {
        container = element
      }}
    >
      <Dynamic component={props.component} {...props.props()} host={host} />
    </box>
  )
}

// ── Markdown fence viewers ───────────────────────────────────────────────────────────────────────

/** Rows a fence viewer may take before the rest is clipped. The pane's own scroll still reaches past
 *  the fence, so a tall viewer cannot push the conversation off the screen. */
const FENCE_VIEW_ROWS = 20

/**
 * The terminal's fence viewers for one content owner (`core:markdown-fence`), as the adapter the kit's
 * `Markdown` takes. The same rule as the desktop's (`client-core/host/markdownFences/`), including the
 * cap of four. Preview and Copy sit on their own line above the fence, outside the viewer, so the
 * source and copying it stay reachable whoever draws it.
 */
export function markdownFences(scope: FenceScope): MarkdownFenceAdapter<JSX.Element> {
  const viewers = createFenceViewers(scope)
  return (fence) => {
    const viewer = viewers(fence)
    return viewer && { preview: viewer.preview, view: <FenceView viewer={viewer} scope={scope} /> }
  }
}

function FenceView(props: { viewer: FenceViewer; scope: FenceScope }) {
  const viewer = props.viewer
  return (
    <Show when={viewer.pluginId()}>
      {(pluginId) => (
        <box flexDirection="column" flexShrink={0}>
          <box flexDirection="row" gap={1} flexShrink={0}>
            <Button label={viewer.preview() ? 'Source' : 'Preview'} onPress={viewer.toggle} />
            <CopyButton text={() => viewer.props.text} />
            <Line role="muted">{`${viewer.props.language} · ${pluginId()}`}</Line>
          </box>
          <Show when={viewer.preview()}>
            <box flexDirection="column" flexShrink={0} maxHeight={FENCE_VIEW_ROWS} overflow="hidden">
              <Slot
                point={CORE_MARKDOWN_FENCE_POINT}
                key={viewer.key}
                props={() => viewer.props}
                {...(props.scope.taskId ? { taskId: props.scope.taskId } : {})}
                {...(props.scope.projectId ? { projectId: props.scope.projectId } : {})}
                occupied={(occupied) => {
                  if (!occupied && viewer.pluginId()) viewer.failed()
                }}
              />
            </box>
          </Show>
        </box>
      )}
    </Show>
  )
}

/** Keep the host API pointed at the diff renderer that owns annotation placement. */
export { AnnotationMarks } from './showing'

/**
 * The `rows` extension kind, in cells.
 *
 * The counterpart of `client-core/host/chrome/ExtensionPointHost.tsx`, and the same division of
 * labour every other node on this barrel keeps: `extensionPoints.ts` decides which contributions are
 * eligible and in what order, and only the drawing is the host's.
 *
 * A `Rows` collection per contributor, at the end of the region that hosts the point, rather than a
 * pinned strip of buttons under the pane: a strip is one more row of chrome on a 24-row screen, and a
 * collection is the one thing on this host every reader already knows how to drive
 * (docs/tui/plugin-losses.md § What a plugin loses here). It draws nothing and registers no stop when the point has
 * no deliveries, so an owner who reserved a footer nobody fills sees the pane exactly as it was.
 */
export function ExtensionRows(props: { point: string }) {
  return (
    <For each={extensionDeliveries(props.point)}>
      {(contribution) => <ExtensionGroupRows contribution={contribution} />}
    </For>
  )
}

/** One contributor's items. Its own component because each contributor is its own fetch, which is the
 *  same shape the DOM's `ExtensionGroup` has and the reason the two cannot be one `<For>`. */
function ExtensionGroupRows(props: { contribution: ExtensionContribution }) {
  const nodeId = activeNodeId() ?? ''
  const [result] = createFleetQuery(
    () => chromeKey(props.contribution.pluginId, props.contribution.id),
    // A contributor whose node is unreachable contributes nothing, which is the same answer as a
    // contributor with nothing to say. Identical to the DOM host's, and for its reasons.
    (_node, _revision, signal) =>
      props.contribution.fetch?.(signal).catch((): PluginExtensionItem[] => []) ?? Promise.resolve([]),
    () => chromeDeps(props.contribution.pluginId),
    { nodeIds: [nodeId] },
  )
  const items = createMemo(() =>
    (result().rows[0]?.data ?? []).map((item) => ({ ...item, key: item.id, label: item.title })),
  )

  return (
    <Show when={items().length}>
      <box flexDirection="column" flexShrink={0}>
        {/* The stamp, on the header rather than on every row: provenance is drawn and not only
            recorded (docs/plugins/cooperative-extension-points.md § Cooperative extension points), and a terminal row has one line
            to spend on the item itself. */}
        <SectionHeader level="group" actions={<Line role="muted">{props.contribution.pluginId}</Line>}>
          {props.contribution.label}
        </SectionHeader>
        <Rows
          id={`extension:${props.contribution.point}:${props.contribution.id}`}
          ariaLabel={props.contribution.label}
          items={items()}
          onActivate={(key) => {
            const item = items().find((candidate) => candidate.key === key)
            if (item) props.contribution.run?.(item)
          }}
        >
          {(item, itemProps) => (
            <Row
              item={itemProps}
              density="compact"
              leading={<Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>}
              trailing={<Show when={item.badge}>{(badge) => <Badge>{badge()}</Badge>}</Show>}
              meta={<Show when={item.subtitle}>{(subtitle) => <Line role="muted">{subtitle()}</Line>}</Show>}
              {...(props.contribution.run ? { onPress: () => props.contribution.run!(item) } : {})}
            >
              {item.title}
            </Row>
          )}
        </Rows>
      </box>
    </Show>
  )
}

/** Another plugin's rectangle beside this one's pane. An iframe, and there is none: the point is
 *  named on one line so a reader knows the box was reserved and why it is empty. */
export function InlineSlot(props: { point: string; key?: string; taskId?: string; projectId?: string | null }) {
  return <Line role="muted">{`${props.point} needs pixels, so it is not drawn here.`}</Line>
}

// ── Selection actions ────────────────────────────────────────────────────────────────────────────

export type { SelectedContent } from '@acorn/client-core/host/registries/panes/SelectionActions.tsx'

/**
 * Other plugins' actions on selected text (`content.selection`), in cells.
 *
 * This host has no text selection to read: nothing here sets one or gets one out (./field.ts). So an
 * owner that names a `whole` block gets an explicit menu after its content that offers that block
 * whole, and says so. An owner with no such block, such as an editor, offers nothing here. The
 * target is taken when the menu opens, and a row runs only while the owner still shows it.
 */
export function SelectionActions(props: SelectionActionsProps) {
  const target = () => (props.whole ? props.select(props.whole()) : undefined)
  const rows = () => {
    const current = target()
    return current ? contextMenuItems('content.selection', current) : []
  }
  return (
    <>
      {props.children}
      <Show when={rows().length}>
        <Menu
          ariaLabel="Actions for the whole text"
          trigger={({ toggle, open }) => (
            <IconButton
              icon="ellipsis"
              label="Actions for the whole text"
              opens="menu"
              expanded={open()}
              onPress={toggle}
            />
          )}
        >
          {(menu) => {
            const opened = untrack(target)
            return (
              <Show
                when={opened && !selectionTooLarge(opened.text)}
                fallback={opened && <Menu.Label>This text is over 64 KiB, so no action can take it.</Menu.Label>}
              >
                <For each={opened ? contextMenuItems('content.selection', opened) : []}>
                  {(row) => (
                    <Menu.Item
                      context={menu}
                      onSelect={() => {
                        if (opened && props.isCurrent(opened)) runContextMenuItem(row, opened)
                      }}
                    >
                      {row.label}
                    </Menu.Item>
                  )}
                </For>
              </Show>
            )
          }}
        </Menu>
      </Show>
    </>
  )
}
