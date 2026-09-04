/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createMemo, For, Show, type JSX } from 'solid-js'
import { Dynamic } from '../tree/renderer'
import { createQuery } from '@tanstack/solid-query'
import type { PluginExtensionItem } from '@acorn/protocol/extensionPoints.ts'
import { PrefKeys } from '@acorn/client-core/infra/persistence/prefKeys.ts'
import { prefsOptions } from '@acorn/client-core/infra/queries.ts'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { createFleetQuery } from '@acorn/client-core/infra/node/fanout.ts'
import {
  extensionDeliveries, extensionPointRegistry, type ExtensionContribution,
} from '@acorn/client-core/host/registries/extensionPoints/extensionPoints.ts'
import { chromeDeps, chromeKey } from '@acorn/client-core/host/chrome/chromeData.ts'
import { resolveSlot, slotChoiceFor, slotChoices } from '@acorn/client-core/host/tree/arbitration.ts'
import type { OverlayPalette } from '@acorn/client-core/host/palette/overlay.ts'
import { RemoteTree } from '../plugins/RemoteTree'
import { htmlLines } from './markdown'
import { Line } from './cells'
import { Badge, Icon, Lines, Row, Rows } from './showing'
import { Input } from './asking'
import { Modal, ModalBody, SectionHeader } from './grouping'

// What `@acorn/plugin-api/ui/host` is on this host.
//
// The sibling of ./ui.ts one rung up. That barrel is the kit, which every pane draws with; this one
// is the *host's* own surfaces — the palette chrome, the drawer, the reference-panel box, the two
// cooperative-extension nodes — and the DOM's copies of them are backdrops, portals and `<ul>`s. A
// pane imports the same names on both hosts and a different component answers each, which is the
// same switch ./ui.ts makes and the reason a pane's source is unchanged here.
//
// Phase 5 left this barrel uncrossed because nothing in that phase's roster used one
// (docs/tui.md). The pane sweep is the phase with the roster.

// ── Host machinery, unchanged ─────────────────────────────────────────────────────────────────────
// Registries and pure rules. None of these draw, so both hosts spend the same module.
export { registerKeybindings } from '@acorn/client-core/host/registries/commands/keybindings.ts'
// From the model rather than from `willPhase.tsx`, which is the DOM's confirmation dialog and would
// bring a `<div>` with it. The registration and the concern type are the model's own.
export { registerWillHandler } from '@acorn/client-core/host/registries/shell/willPhaseModel.ts'
export type { Concern } from '@acorn/client-core/host/registries/shell/willPhaseModel.ts'
export { slotFills } from '@acorn/client-core/host/tree/arbitration.ts'
export { requestAnnotations, annotationsFor } from '@acorn/client-core/host/annotations/annotations.ts'
export { selectPaneTab } from '@acorn/client-core/host/layouts/state.ts'
export { RemoteTree } from '../plugins/RemoteTree'
export type { RemoteTreeProps } from '../plugins/RemoteTree'
// The `wizard` layout for a surface that is a wizard and is not a pane. The same component the layout
// table hands the pane registry, so onboarding's overlay and a `wizard` pane are arranged alike.
export { Wizard } from '../layouts/Wizard'

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
 *  (docs/tui.md § What is drawn bespoke). So the box stays and the geography
 *  goes, and `height` is ignored because a pixel count is not a thing a cell host can spend. */
export function Drawer(props: { height: number; maximized?: boolean; ariaLabel: string; ref?: (element: HTMLElement) => void; children: JSX.Element }) {
  return <box flexDirection="column" flexGrow={1}>{props.children}</box>
}

/** A palette overlay somebody else owns: the editor's file finder, github's shortcut sheet.
 *
 *  The shell's own palette is `chrome/Palette.tsx` and is not this — it is core-owned and drives the
 *  overlay stack (docs/tui.md). This is the deduped chrome a *plugin* opens,
 *  and here it is the same `Modal` with a filter field and a list of rows, because that is what a
 *  terminal overlay is.
 *
 *  The cursor is the hook's, exactly as on the desktop: an input owns the typing, so a collection's
 *  bare keys would never fire inside one. What the hook cannot give this host is a DOM key event, so
 *  the arrows and Enter are the modal's own layer. */
export function PaletteSurface<T>(props: {
  palette: OverlayPalette
  items: readonly T[]
  placeholder: string
  emptyText: string
  row: (item: T, selected: boolean) => JSX.Element
  rowClassList?: (item: T) => Record<string, boolean | undefined>
  onPick: (item: T, index: number) => void
  footer?: JSX.Element
  status?: JSX.Element
  class?: string
  ariaLabel?: string
}) {
  return (
    <Show when={props.palette.open()}>
      <Modal onDismiss={props.palette.close} title={props.ariaLabel} size="wide">
        <ModalBody>
          <Input
            kind="filter"
            placeholder={props.placeholder}
            value={props.palette.query()}
            onInput={(value) => props.palette.setQuery(value)}
          />
          <Show when={props.status}>{props.status}</Show>
          <For each={props.items} fallback={<Line role="muted">{props.emptyText}</Line>}>
            {(item, index) => (
              <Row selected={index() === props.palette.sel()} leading={index() === props.palette.sel() ? '›' : ' '}>
                {props.row(item, index() === props.palette.sel())}
              </Row>
            )}
          </For>
          <Show when={props.footer}>{props.footer}</Show>
        </ModalBody>
      </Modal>
    </Show>
  )
}

/** The box a reference panel is drawn in. A drawer over half the window on the desktop; a modal where
 *  the pane goes here, for the reason every other overlay flattens (../kit/grouping.tsx). */
export default function RefPanelBoxDefault(props: { title: string; onClose: () => void; children: JSX.Element; footer?: JSX.Element }) {
  return (
    <Modal onDismiss={props.onClose} title={props.title} size="lg">
      <ModalBody>{props.children}</ModalBody>
      {props.footer}
    </Modal>
  )
}
export { RefPanelBoxDefault as RefPanelBox }

/** "Is there a task for this thing, and if not, start one".
 *
 *  Absent, and it says so. The DOM control is a `Select` of repos and a create button wired to the
 *  router — and there is no router here, which is the same reason `RemoteTree` passes an empty
 *  `navigate`. A reader who wants a task for this reference makes one in the rail, which is two keys
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

export type SlotProps = {
  point: string
  key?: string
  props?: () => unknown
  children?: JSX.Element
  taskId?: string
  projectId?: string | null
  /** What this owner will do if a contributor asks (docs/plugins.md § Asking the owner). Host-only:
   *  neither the handlers nor their names are sent to the worker. */
  actions?: Record<string, (payload: unknown) => unknown | Promise<unknown>>
  /** Whether a contributor is standing in for the owner's default right now, for an owner that has to
   *  keep drawing something a contributor must not be given. */
  occupied?: (occupied: boolean) => void
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
  const prefs = createQuery(() => prefsOptions(true))

  const resolved = createMemo(() => {
    const point = extensionPointRegistry.get(props.point)
    if (!point || point.kind !== 'remote') return null
    const choices = slotChoices(prefs.data?.[PrefKeys.remoteSlots])
    return {
      mode: point.mode ?? 'stack',
      actions: point.actions ?? [],
      outcome: resolveSlot(point, props.key, slotChoiceFor(choices, props.point, props.key)),
    }
  })
  const outcome = () => resolved()?.outcome
  const drawDefault = () => resolved()?.mode !== 'replace' || !outcome()?.occupants.length

  createEffect(() => props.occupied?.(!drawDefault()))

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
                />
              }
            >
              {(component) => <Dynamic component={component()} {...(props.props?.() as Record<string, unknown>)} />}
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

/** One item's marks, drawn where the owner put them. In `./showing.tsx` beside the diff line that
 *  draws them, because a `text` node cannot hold a component from a module that imports it back. */
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
 * (docs/tui.md § What a plugin loses here). It draws nothing and registers no stop when the point has
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
    (result().rows[0]?.data ?? []).map((item) => ({ ...item, key: item.id, label: item.title })))

  return (
    <Show when={items().length}>
      <box flexDirection="column" flexShrink={0}>
        {/* The stamp, on the header rather than on every row: provenance is drawn and not only
            recorded (docs/plugins.md § Cooperative extension points), and a terminal row has one line
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
