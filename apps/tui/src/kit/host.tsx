/** @jsxImportSource @opentui/solid */
import { createMemo, For, Show, type JSX } from 'solid-js'
import { Dynamic } from '@opentui/solid'
import { createQuery } from '@tanstack/solid-query'
import type { PluginAnnotationKey } from '@acorn/protocol/extensionPoints.ts'
import { PrefKeys } from '@acorn/client-core/infra/persistence/prefKeys.ts'
import { prefsOptions } from '@acorn/client-core/infra/queries.ts'
import { extensionPointRegistry } from '@acorn/client-core/host/registries/extensionPoints/extensionPoints.ts'
import { resolveSlot, slotChoiceFor, slotChoices } from '@acorn/client-core/host/tree/arbitration.ts'
import { annotationsFor } from '@acorn/client-core/host/annotations/annotations.ts'
import type { OverlayPalette } from '@acorn/client-core/host/palette/overlay.ts'
import { RemoteTree } from '../plugins/RemoteTree'
import { htmlLines } from './markdown'
import { Line } from './cells'
import { Icon, Lines, Row } from './showing'
import { Input } from './asking'
import { Modal, ModalBody } from './grouping'

// What `@acorn/plugin-api/ui/host` is on this host.
//
// The sibling of ./ui.ts one rung up. That barrel is the kit, which every pane draws with; this one
// is the *host's* own surfaces — the palette chrome, the drawer, the reference-panel box, the two
// cooperative-extension nodes — and the DOM's copies of them are backdrops, portals and `<ul>`s. A
// pane imports the same names on both hosts and a different component answers each, which is the
// same switch ./ui.ts makes and the reason a pane's source is unchanged here.
//
// Phase 5 left this barrel uncrossed because nothing in that phase's roster used one
// (docs/future/terminal/phase-5-loaded-plugins.md). The pane sweep is the phase with the roster.

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
 *  (docs/future/terminal/07-chrome.md § What is drawn bespoke). So the box stays and the geography
 *  goes, and `height` is ignored because a pixel count is not a thing a cell host can spend. */
export function Drawer(props: { height: number; maximized?: boolean; ariaLabel: string; ref?: (element: HTMLElement) => void; children: JSX.Element }) {
  return <box flexDirection="column" flexGrow={1}>{props.children}</box>
}

/** A palette overlay somebody else owns: the editor's file finder, github's shortcut sheet.
 *
 *  The shell's own palette is `chrome/Palette.tsx` and is not this — it is core-owned and drives the
 *  overlay stack (docs/future/terminal/07-chrome.md). This is the deduped chrome a *plugin* opens,
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
}

/**
 * A place in one plugin's tree where another plugin's tree may be grafted.
 *
 * The terminal's sibling of `client-core/host/tree/Slot.tsx`, and the same division of labour every
 * other one keeps: `arbitration.ts` decides who draws and is shared unchanged; only the drawing is
 * the host's. Two things differ, and both are the host switch rather than a rule: `Dynamic` comes
 * from `@opentui/solid` rather than `solid-js/web`, because pulling the DOM renderer in for one
 * component would put a second Solid renderer in this process; and the overflow disclosure is a line
 * of muted text rather than a `<span class="muted">`.
 */
export function Slot(props: SlotProps) {
  const prefs = createQuery(() => prefsOptions(true))

  const resolved = createMemo(() => {
    const point = extensionPointRegistry.get(props.point)
    if (!point || point.kind !== 'remote') return null
    const choices = slotChoices(prefs.data?.[PrefKeys.remoteSlots])
    return { mode: point.mode ?? 'stack', outcome: resolveSlot(point, props.key, slotChoiceFor(choices, props.point, props.key)) }
  })
  const outcome = () => resolved()?.outcome
  const drawDefault = () => resolved()?.mode !== 'replace' || !outcome()?.occupants.length

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
                  }}
                  props={props.props ?? (() => ({}))}
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

/** One item's marks, drawn where the owner put them. The DOM stacks icon, text and owner in a row of
 *  spans; here they are the same three in the same order, on one line. */
export function AnnotationMarks(props: { point: string; itemKey: PluginAnnotationKey }) {
  const marks = () => annotationsFor(props.point, props.itemKey)
  return (
    <box flexDirection="row" gap={1}>
      <For each={marks()}>
        {(mark) => (
          <box flexDirection="row" gap={1}>
            <Show when={mark.icon}>{(name) => <Icon name={name()} />}</Show>
            <Line tone={mark.severity === 'danger' ? 'danger' : mark.severity === 'warn' ? 'warn' : undefined}>{mark.text}</Line>
            <Line role="muted">{mark.pluginId}</Line>
          </box>
        )}
      </For>
    </box>
  )
}

/** Another plugin's rectangle beside this one's pane. An iframe, and there is none: the point is
 *  named on one line so a reader knows the box was reserved and why it is empty. */
export function InlineSlot(props: { point: string; key?: string; taskId?: string; projectId?: string | null }) {
  return <Line role="muted">{`${props.point} needs pixels, so it is not drawn here.`}</Line>
}
