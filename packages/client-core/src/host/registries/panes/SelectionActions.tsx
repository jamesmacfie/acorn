import { createSignal, For, Show, type JSX } from 'solid-js'
import { isLanguageId, languageIdForPath } from '@acorn/protocol/languageIds.ts'
import Icon from '../../../kit/components/content/Icon'
import { ContextMenu, Menu, type MenuContext } from '../../../kit/components/overlays/Menu'
import { contextMenuItems, runContextMenuItem, type ContentSelectionTarget } from './contextMenus'
import { selectionTooLarge } from './contentSelection'

// Other plugins' actions on text a person selected in content an owner draws (`content.selection`).
// See docs/plugins/menus-and-markers.md § Context menus.
//
// The owner wraps its content in this. Nothing listens to the selection as it changes: the person's
// selection is read once, when they right-click it or press Shift+F10 or the menu key inside the
// owner, and only then does the owner say what the target is. The terminal has its own twin
// (apps/tui/src/kit/host.tsx), which has no selection to read and offers the owner's whole block.

/** What is selected, as the host reads it from rendered content: plain text, and its language when it
 *  lies inside one code fence. */
export type SelectedContent = { text: string; contentKind: 'markdown' | 'code'; languageId?: string }

export type SelectionActionsProps = {
  /** The owner's target for what is selected now, or none. The desktop hands it the person's selection
   *  inside this boundary. An owner whose selection lives in its own model, such as an editor, ignores
   *  that and reads its own. */
  select: (selected: SelectedContent | undefined) => ContentSelectionTarget | undefined
  /** Does the owner still show what the target was taken from? Checked before a row runs, so a row
   *  never acts on text that has changed since the menu opened. */
  isCurrent: (target: ContentSelectionTarget) => boolean
  /** The block a host with no range selection offers whole. Only the terminal reads it. */
  whole?: () => SelectedContent
  children: JSX.Element
}

// A fence's language hint, in the same ids an editor's document uses, so one `when` matches both.
const fenceLanguage = (hint: string | undefined): string | undefined =>
  hint === undefined ? undefined : isLanguageId(hint) ? hint : languageIdForPath(`f.${hint}`)

/** The person's selection, when it lies wholly inside `root`. A selection that starts or ends outside
 *  belongs to no one owner, so it has none. */
function selectedContent(root: HTMLElement): SelectedContent | undefined {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return undefined
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined
  const text = selection.toString()
  if (!text.trim()) return undefined
  const fence = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.ui-code-wrap')
  const code = fence(range.startContainer)
  return code && code === fence(range.endContainer)
    ? { text, contentKind: 'code', languageId: fenceLanguage(code.dataset.language) }
    : { text, contentKind: 'markdown' }
}

type Opening = { at: { x: number; y: number }; target: ContentSelectionTarget; returnTo?: HTMLElement; range?: Range }

// WebKit clears the page's selection when the menu's first item takes focus. Put the person's back
// when the menu closes, unless the text it covered has gone.
const restore = (range: Range | undefined) => {
  if (!range?.startContainer.isConnected || !range.endContainer.isConnected) return
  const selection = range.startContainer.ownerDocument?.getSelection()
  if (!selection || !selection.isCollapsed) return
  selection.removeAllRanges()
  selection.addRange(range)
}

export function SelectionActions(props: SelectionActionsProps) {
  let root: HTMLDivElement | undefined
  const [opening, setOpening] = createSignal<Opening | null>(null)
  const onContextMenu = (event: MouseEvent) => {
    // Option + right-click keeps the platform's menu, and a link keeps its own.
    if (!root || event.defaultPrevented || event.altKey || (event.target as Element | null)?.closest?.('a[href]')) return
    const target = props.select(selectedContent(root))
    // With nothing to offer, the platform's menu is the right answer.
    if (!target || !contextMenuItems('content.selection', target).length) return
    event.preventDefault()
    const active = root.ownerDocument.activeElement
    const selection = root.ownerDocument.getSelection()
    setOpening({
      at: { x: event.clientX, y: event.clientY }, target,
      ...(active instanceof HTMLElement && root.contains(active) ? { returnTo: active } : {}),
      ...(selection?.rangeCount ? { range: selection.getRangeAt(0).cloneRange() } : {}),
    })
  }
  return (
    // `display: contents`, so wrapping an owner's content changes none of its layout.
    <div ref={(element) => { root = element }} style={{ display: 'contents' }} onContextMenu={onContextMenu}>
      {props.children}
      <ContextMenu
        at={() => opening()?.at ?? null}
        ariaLabel="Actions for selection"
        onClose={() => {
          const range = opening()?.range
          setOpening(null)
          restore(range)
        }}
        returnFocus={() => opening()?.returnTo}
      >
        {(menu) => (
          <Show when={opening()}>
            {(open) => (
              <SelectionMenuRows context={menu} target={open().target} isCurrent={props.isCurrent} />
            )}
          </Show>
        )}
      </ContextMenu>
    </div>
  )
}

/** Copy, then the rows other plugins offer, or the reason there are none to run. */
function SelectionMenuRows(props: {
  context: MenuContext
  target: ContentSelectionTarget
  isCurrent: (target: ContentSelectionTarget) => boolean
}) {
  const rows = () => contextMenuItems('content.selection', props.target)
  return (
    <>
      {/* The platform's menu this replaced had Copy, so this one keeps it. */}
      <Menu.Item context={props.context} onSelect={() => void navigator.clipboard?.writeText(props.target.text)}>Copy</Menu.Item>
      <Menu.Separator />
      {/* Refused whole rather than cut: an action on part of what the person chose is not what they
          asked for. */}
      <Show when={!selectionTooLarge(props.target.text)} fallback={<Menu.Label>This selection is over 64 KiB. Select less to use an action.</Menu.Label>}>
        <For each={rows()}>
          {(row) => (
            <Menu.Item
              context={props.context}
              leading={row.icon ? <Icon name={row.icon} /> : undefined}
              onSelect={() => { if (props.isCurrent(props.target)) runContextMenuItem(row, props.target) }}
            >
              {row.label}
            </Menu.Item>
          )}
        </For>
      </Show>
    </>
  )
}
